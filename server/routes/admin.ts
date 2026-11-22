import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import argon2 from 'argon2'
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm'
import type { FastifyPluginAsync } from 'fastify'
import sharp, { type Metadata } from 'sharp'
import { z } from 'zod'
import { config } from '../config.js'
import { db } from '../db/client.js'
import {
  adminSessions,
  adminUsers,
  documents,
  mediaAssets,
  navGroups,
  publicationDocuments,
  publicationGroups,
  publications,
  siteSettings,
  siteState
} from '../db/schema.js'
import { audit } from '../lib/audit.js'
import {
  createSession,
  destroySession,
  requireAdmin,
  verifyCsrf,
  verifyPassword
} from '../lib/auth.js'
import { prefixDocumentIds, renderMarkdown } from '../lib/markdown.js'
import { slugify } from '../lib/slug.js'
import { readPublicationState } from '../lib/publication-state.js'
import { documentUpdateTime } from '../lib/publication-diff.js'

const loginSchema = z.object({ username: z.string().trim().min(1).max(80), password: z.string().min(1).max(256) })
const settingsSchema = z.object({
  siteName: z.string().trim().min(1).max(120),
  subtitle: z.string().trim().max(255),
  consoleUrl: z.url().max(500),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/)
})
const groupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  anchor: z.string().trim().max(160).optional(),
  isVisible: z.boolean().default(true)
})
const documentSchema = z.object({
  groupId: z.number().int().positive(),
  title: z.string().trim().min(1).max(180),
  navLabel: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(180),
  markdown: z.string().max(2_000_000),
  isVisible: z.boolean()
})
const reorderSchema = z.object({
  groups: z.array(z.object({ id: z.number().int().positive(), documentIds: z.array(z.number().int().positive()) }))
})

async function uniqueGroupAnchor(value: string, excludeId?: number) {
  const base = slugify(value, 'group')
  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`
    const conditions = [eq(navGroups.anchor, candidate)]
    if (excludeId) conditions.push(ne(navGroups.id, excludeId))
    const [existing] = await db.select({ id: navGroups.id }).from(navGroups).where(and(...conditions)).limit(1)
    if (!existing) return candidate
  }
  return `${base}-${randomUUID().slice(0, 8)}`
}

async function uniqueDocumentSlug(value: string, excludeId?: number) {
  const base = slugify(value, 'document')
  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`
    const conditions = [eq(documents.slug, candidate)]
    if (excludeId) conditions.push(ne(documents.id, excludeId))
    const [existing] = await db.select({ id: documents.id }).from(documents).where(and(...conditions)).limit(1)
    if (!existing) return candidate
  }
  return `${base}-${randomUUID().slice(0, 8)}`
}

async function contentPayload() {
  const { settings, groups, docs, status } = await readPublicationState()
  return {
    settings,
    activePublicationId: status.activePublicationId,
    publicationStatus: status,
    groups: groups.map((group) => ({ ...group, documents: docs.filter((doc) => doc.groupId === group.id) }))
  }
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.post('/login', {
    config: { rateLimit: { max: 8, timeWindow: '15 minutes' } }
  }, async (request, reply) => {
    const body = loginSchema.parse(request.body)
    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.username, body.username)).limit(1)
    if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
      return reply.code(401).send({ error: '用户名或密码错误' })
    }
    await createSession(reply, user.id)
    await audit(user.id, 'login', 'session')
    return { user: { id: user.id, username: user.username } }
  })

  app.register(async (protectedApp) => {
    protectedApp.addHook('preHandler', requireAdmin)
    protectedApp.addHook('preHandler', verifyCsrf)

    protectedApp.get('/me', async (request) => ({ user: request.admin }))

    protectedApp.post('/logout', async (request, reply) => {
      await audit(request.admin!.id, 'logout', 'session')
      await destroySession(request, reply)
      return { ok: true }
    })

    protectedApp.put('/password', async (request, reply) => {
      const body = z.object({ currentPassword: z.string(), newPassword: z.string().min(12).max(256) }).parse(request.body)
      const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, request.admin!.id)).limit(1)
      if (!user || !(await verifyPassword(user.passwordHash, body.currentPassword))) {
        return reply.code(400).send({ error: '当前密码不正确' })
      }
      const passwordHash = await argon2.hash(body.newPassword, { type: argon2.argon2id })
      await db.update(adminUsers).set({ passwordHash, updatedAt: new Date() }).where(eq(adminUsers.id, user.id))
      await db.delete(adminSessions).where(eq(adminSessions.userId, user.id))
      await audit(user.id, 'password_change', 'admin_user', user.id)
      await destroySession(request, reply)
      return { ok: true }
    })

    protectedApp.get('/content', async () => contentPayload())

    protectedApp.put('/settings', async (request) => {
      const body = settingsSchema.parse(request.body)
      await db.update(siteSettings).set({ ...body, updatedAt: new Date() }).where(eq(siteSettings.id, 1))
      await audit(request.admin!.id, 'update', 'site_settings', 1)
      return { settings: body }
    })

    protectedApp.post('/groups', async (request) => {
      const body = groupSchema.parse(request.body)
      const [{ nextOrder }] = await db.select({ nextOrder: sql<number>`coalesce(max(${navGroups.sortOrder}), -1) + 1` }).from(navGroups)
      const anchor = await uniqueGroupAnchor(body.anchor || body.name)
      const [created] = await db.insert(navGroups).values({
        name: body.name,
        anchor,
        sortOrder: Number(nextOrder),
        isVisible: body.isVisible
      }).$returningId()
      await audit(request.admin!.id, 'create', 'nav_group', created.id)
      return { id: created.id }
    })

    protectedApp.put('/groups/:id', async (request) => {
      const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id)
      const body = groupSchema.parse(request.body)
      const anchor = await uniqueGroupAnchor(body.anchor || body.name, id)
      await db.update(navGroups).set({ name: body.name, anchor, isVisible: body.isVisible, updatedAt: new Date() })
        .where(eq(navGroups.id, id))
      await audit(request.admin!.id, 'update', 'nav_group', id)
      return { ok: true }
    })

    protectedApp.delete('/groups/:id', async (request) => {
      const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id)
      await db.delete(navGroups).where(eq(navGroups.id, id))
      await audit(request.admin!.id, 'delete', 'nav_group', id)
      return { ok: true }
    })

    protectedApp.post('/documents', async (request) => {
      const body = z.object({ groupId: z.number().int().positive() }).parse(request.body)
      const [group] = await db.select({ id: navGroups.id }).from(navGroups).where(eq(navGroups.id, body.groupId)).limit(1)
      if (!group) throw Object.assign(new Error('导航分组不存在'), { statusCode: 404 })
      const [{ nextOrder }] = await db.select({ nextOrder: sql<number>`coalesce(max(${documents.sortOrder}), -1) + 1` })
        .from(documents).where(eq(documents.groupId, body.groupId))
      const slug = await uniqueDocumentSlug('未命名文档')
      const [created] = await db.insert(documents).values({
        groupId: body.groupId,
        title: '未命名文档',
        navLabel: '未命名文档',
        slug,
        markdown: '',
        sortOrder: Number(nextOrder),
        isVisible: true
      }).$returningId()
      await audit(request.admin!.id, 'create', 'document', created.id)
      return { id: created.id }
    })

    protectedApp.put('/documents/:id', async (request) => {
      const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id)
      const body = documentSchema.parse(request.body)
      const slug = await uniqueDocumentSlug(body.slug, id)
      await db.update(documents).set({ ...body, slug, updatedAt: new Date() }).where(eq(documents.id, id))
      await audit(request.admin!.id, 'update', 'document', id)
      return { ok: true, slug }
    })

    protectedApp.delete('/documents/:id', async (request) => {
      const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id)
      await db.delete(documents).where(eq(documents.id, id))
      await audit(request.admin!.id, 'delete', 'document', id)
      return { ok: true }
    })

    protectedApp.put('/reorder', async (request) => {
      const body = reorderSchema.parse(request.body)
      await db.transaction(async (tx) => {
        for (const [groupIndex, group] of body.groups.entries()) {
          await tx.update(navGroups).set({ sortOrder: groupIndex, updatedAt: new Date() }).where(eq(navGroups.id, group.id))
          for (const [docIndex, documentId] of group.documentIds.entries()) {
            await tx.update(documents).set({ groupId: group.id, sortOrder: docIndex, updatedAt: new Date() })
              .where(eq(documents.id, documentId))
          }
        }
      })
      await audit(request.admin!.id, 'reorder', 'content')
      return { ok: true }
    })

    protectedApp.post('/preview', async (request) => {
      const { markdown } = z.object({ markdown: z.string().max(2_000_000) }).parse(request.body)
      return renderMarkdown(markdown)
    })

    protectedApp.post('/uploads', async (request, reply) => {
      const upload = await request.file({ limits: { fileSize: config.maxUploadBytes, files: 1 } })
      if (!upload) return reply.code(400).send({ error: '请选择图片' })
      const buffer = await upload.toBuffer()
      if (upload.file.truncated) return reply.code(413).send({ error: '图片超过大小限制' })

      let metadata: Metadata
      try {
        metadata = await sharp(buffer, { animated: true }).metadata()
      } catch {
        return reply.code(415).send({ error: '无法识别该图片' })
      }
      const formats: Record<string, { mime: string; extension: string }> = {
        jpeg: { mime: 'image/jpeg', extension: 'jpg' },
        png: { mime: 'image/png', extension: 'png' },
        webp: { mime: 'image/webp', extension: 'webp' },
        gif: { mime: 'image/gif', extension: 'gif' }
      }
      const format = metadata.format ? formats[metadata.format] : undefined
      if (!format) return reply.code(415).send({ error: '仅支持 PNG、JPEG、WebP 和 GIF' })

      const now = new Date()
      const relativeDir = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`
      const storageName = `${relativeDir}/${randomUUID()}.${format.extension}`
      const destinationDir = path.join(config.uploadDir, relativeDir)
      await mkdir(destinationDir, { recursive: true })
      await writeFile(path.join(config.uploadDir, storageName), buffer, { flag: 'wx' })
      const urlPath = `/uploads/${storageName}`
      const [created] = await db.insert(mediaAssets).values({
        storageName,
        originalName: path.basename(upload.filename).slice(0, 255),
        mime: format.mime,
        byteSize: buffer.length,
        width: metadata.width ?? null,
        height: metadata.height ?? null,
        urlPath,
        createdBy: request.admin!.id
      }).$returningId()
      await audit(request.admin!.id, 'upload', 'media_asset', created.id, { urlPath })
      return { id: created.id, url: urlPath, width: metadata.width, height: metadata.height }
    })

    protectedApp.get('/publication-status', async () => (await readPublicationState()).status)

    protectedApp.post('/publications', async (request) => {
      const result = await db.transaction(async (tx) => {
        // Serialize publishes so concurrent clicks cannot create duplicate versions.
        await tx.select().from(siteState).where(eq(siteState.id, 1)).for('update')
        const { snapshot, previousPublication, previousDocs, status } = await readPublicationState(tx)
        if (!status.changes.hasChanges) {
          return { id: status.activePublicationId!, documentCount: status.changes.documentCount, unchanged: true }
        }
        const publishedAt = new Date()
        const [created] = await tx.insert(publications).values({
          ...snapshot.settings,
          documentCount: status.changes.documentCount,
          createdBy: request.admin!.id,
          createdAt: publishedAt
        }).$returningId()
        const oldById = new Map(previousDocs.map((doc) => [doc.sourceDocumentId, { ...doc, id: doc.sourceDocumentId }]))
        for (const [groupIndex, group] of snapshot.groups.entries()) {
          const [publishedGroup] = await tx.insert(publicationGroups).values({
            publicationId: created.id,
            sourceGroupId: group.id,
            name: group.name,
            anchor: group.anchor,
            sortOrder: groupIndex
          }).$returningId()
          if (group.documents.length > 0) {
            await tx.insert(publicationDocuments).values(group.documents.map((document, docIndex) => {
              const rendered = renderMarkdown(document.markdown)
              return {
                publicationId: created.id,
                publicationGroupId: publishedGroup.id,
                sourceDocumentId: document.id,
                title: document.title,
                navLabel: document.navLabel,
                slug: document.slug,
                markdown: document.markdown,
                renderedHtml: prefixDocumentIds(rendered.html, document.slug),
                searchText: rendered.searchText,
                contentUpdatedAt: documentUpdateTime(document, oldById.get(document.id), previousPublication?.createdAt, publishedAt),
                sortOrder: docIndex
              }
            }))
          }
        }
        await tx.update(siteState).set({ activePublicationId: created.id, updatedAt: publishedAt }).where(eq(siteState.id, 1))
        return { id: created.id, documentCount: status.changes.documentCount, unchanged: false }
      })
      if (!result.unchanged) {
        await audit(request.admin!.id, 'publish', 'publication', result.id, { documentCount: result.documentCount })
      }
      return result
    })

    protectedApp.get('/publications', async () => {
      const [state] = await db.select().from(siteState).where(eq(siteState.id, 1)).limit(1)
      const items = await db.select({
        id: publications.id,
        documentCount: publications.documentCount,
        createdAt: publications.createdAt,
        username: adminUsers.username
      }).from(publications)
        .innerJoin(adminUsers, eq(adminUsers.id, publications.createdBy))
        .orderBy(desc(publications.createdAt)).limit(30)
      return { activePublicationId: state?.activePublicationId ?? null, items }
    })

    protectedApp.post('/publications/:id/restore', async (request) => {
      const publicationId = z.coerce.number().int().positive().parse((request.params as { id: string }).id)
      const [publication] = await db.select().from(publications).where(eq(publications.id, publicationId)).limit(1)
      if (!publication) throw Object.assign(new Error('发布版本不存在'), { statusCode: 404 })
      const groups = await db.select().from(publicationGroups).where(eq(publicationGroups.publicationId, publicationId))
        .orderBy(asc(publicationGroups.sortOrder))
      const docs = await db.select().from(publicationDocuments).where(eq(publicationDocuments.publicationId, publicationId))
        .orderBy(asc(publicationDocuments.sortOrder))

      await db.transaction(async (tx) => {
        await tx.delete(documents)
        await tx.delete(navGroups)
        await tx.update(siteSettings).set({
          siteName: publication.siteName,
          subtitle: publication.subtitle,
          consoleUrl: publication.consoleUrl,
          accentColor: publication.accentColor,
          updatedAt: new Date()
        }).where(eq(siteSettings.id, 1))
        for (const group of groups) {
          await tx.insert(navGroups).values({
            id: group.sourceGroupId,
            name: group.name,
            anchor: group.anchor,
            sortOrder: group.sortOrder,
            isVisible: true
          })
        }
        if (docs.length > 0) {
          const groupSourceByPublished = new Map(groups.map((group) => [group.id, group.sourceGroupId]))
          await tx.insert(documents).values(docs.map((document) => ({
            id: document.sourceDocumentId,
            groupId: groupSourceByPublished.get(document.publicationGroupId)!,
            title: document.title,
            navLabel: document.navLabel,
            slug: document.slug,
            markdown: document.markdown,
            sortOrder: document.sortOrder,
            isVisible: true
          })))
        }
      })
      await audit(request.admin!.id, 'restore_to_draft', 'publication', publicationId)
      return { ok: true }
    })
  })
}
