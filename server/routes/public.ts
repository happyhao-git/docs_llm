import { createHash } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client.js'
import { mediaAssets, publicationDocuments, publicationGroups, publications, siteSettings, siteState } from '../db/schema.js'
import { addImageDimensions, documentMetadata, searchDocuments } from '../lib/public-content.js'

function sendCached(request: FastifyRequest, reply: FastifyReply, payload: unknown) {
  const serialized = JSON.stringify(payload)
  const etag = `"${createHash('sha256').update(serialized).digest('base64url')}"`
  reply.header('ETag', etag).header('Cache-Control', 'public, max-age=0, must-revalidate')
  // Reverse proxies may weaken validators when compressing a response. GET uses
  // weak comparison for If-None-Match, including a list of cached validators.
  const validators = String(request.headers['if-none-match'] ?? '').match(/(?:W\/)?"[^"]*"|\*/g) ?? []
  if (validators.some((tag) => tag === '*' || tag.replace(/^W\//, '') === etag)) return reply.code(304).send()
  return reply.type('application/json; charset=utf-8').send(serialized)
}

export const publicRoutes: FastifyPluginAsync = async (app) => {
  async function buildSnapshot(publicationId: number) {
    const [publication] = await db.select().from(publications).where(eq(publications.id, publicationId)).limit(1)
    const groups = await db.select().from(publicationGroups).where(eq(publicationGroups.publicationId, publicationId)).orderBy(asc(publicationGroups.sortOrder), asc(publicationGroups.id))
    const docs = await db.select().from(publicationDocuments).where(eq(publicationDocuments.publicationId, publicationId)).orderBy(asc(publicationDocuments.sortOrder), asc(publicationDocuments.id))
    const assets = await db.select({ urlPath: mediaAssets.urlPath, width: mediaAssets.width, height: mediaAssets.height }).from(mediaAssets)
    const dimensions = new Map(assets.map((asset) => [asset.urlPath, asset]))
    return {
      settings: { siteName: publication.siteName, subtitle: publication.subtitle, consoleUrl: publication.consoleUrl, accentColor: publication.accentColor },
      publication: { id: publication.id, createdAt: publication.createdAt },
      groups: groups.map((group) => ({ id: group.id, name: group.name, anchor: group.anchor,
        documents: docs.filter((doc) => doc.publicationGroupId === group.id).map((doc) => ({
          id: doc.id, title: doc.title, navLabel: doc.navLabel, slug: doc.slug,
          updatedAt: doc.contentUpdatedAt ?? publication.createdAt, html: addImageDimensions(doc.renderedHtml, dimensions),
          searchText: doc.searchText, ...documentMetadata(doc.renderedHtml)
        })) }))
    }
  }
  // Coalesce concurrent misses. Keep a bounded cache of immutable publication snapshots.
  const snapshots = new Map<number, ReturnType<typeof buildSnapshot>>()
  async function getSite() {
    const [state] = await db.select().from(siteState).where(eq(siteState.id, 1)).limit(1)
    if (!state?.activePublicationId) {
      const [settings] = await db.select().from(siteSettings).where(eq(siteSettings.id, 1)).limit(1)
      return { settings, publication: null, groups: [] }
    }
    const id = state.activePublicationId
    if (!snapshots.has(id)) {
      const pending = buildSnapshot(id).catch((error) => { snapshots.delete(id); throw error })
      snapshots.set(id, pending)
      while (snapshots.size > 3) snapshots.delete(snapshots.keys().next().value!)
    }
    return snapshots.get(id)!
  }
  app.get('/site-config', async (request, reply) => {
    const site = await getSite()
    return sendCached(request, reply, { settings: site.settings })
  })
  app.get('/site', async (request, reply) => sendCached(request, reply, await getSite()))
  app.get('/navigation', async (request, reply) => {
    const site = await getSite()
    return sendCached(request, reply, { ...site, groups: site.groups.map((group) => ({ ...group,
      documents: group.documents.map(({ html: _html, searchText: _text, outline: _outline, ...doc }) => doc)
    })) })
  })
  app.get('/documents/:slug', async (request, reply) => {
    const slug = z.string().min(1).max(180).parse((request.params as { slug: string }).slug)
    const site = await getSite()
    const document = site.groups.flatMap((group) => group.documents).find((doc) => doc.slug === slug)
    if (!document) return reply.code(404).send({ error: '这篇教程不存在或尚未发布', publication: site.publication })
    return sendCached(request, reply, { publication: site.publication, document })
  })
  app.get('/search', async (request, reply) => {
    const { q } = z.object({ q: z.string().trim().max(120).default('') }).parse(request.query)
    const site = await getSite()
    return sendCached(request, reply, { publication: site.publication, results: searchDocuments(site.groups.flatMap((group) => group.documents), q) })
  })
}
