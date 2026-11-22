import cookie from '@fastify/cookie'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Run only against the disposable MySQL instance, never the configured application database.
describe.skipIf(process.env.RUN_DB_TESTS !== '1')('publication API with MySQL', () => {
  const app = Fastify()
  let db: typeof import('../db/client.js')['db']
  let pool: typeof import('../db/client.js')['pool']
  let schema: typeof import('../db/schema.js')
  let currentId: number
  const headers = { cookie: 'docs_session=verification-session; docs_csrf=verification-csrf', 'x-csrf-token': 'verification-csrf' }
  const publish = () => app.inject({ method: 'POST', url: '/api/admin/publications', headers })
  const status = async () => (await app.inject({ url: '/api/admin/publication-status', headers })).json()

  beforeAll(async () => {
    if (process.env.DB_NAME !== 'docs_test' || process.env.DB_PORT !== '13367') throw new Error('Disposable test database required')
    ;({ db, pool } = await import('../db/client.js'))
    schema = await import('../db/schema.js')
    const { migrate } = await import('../db/migrate.js')
    await migrate(pool)
    const { adminRoutes } = await import('./admin.js')
    const { publicRoutes } = await import('./public.js')
    const { hashToken } = await import('../lib/auth.js')
    await db.insert(schema.adminUsers).values({ id: 1, username: 'verification', passwordHash: 'unused' })
      .onDuplicateKeyUpdate({ set: { username: 'verification' } })
    const expiresAt = new Date(Date.now() + 3600000)
    await db.insert(schema.adminSessions).values({ userId: 1, tokenHash: hashToken('verification-session'), expiresAt })
      .onDuplicateKeyUpdate({ set: { expiresAt } })
    await app.register(cookie)
    await app.register(adminRoutes, { prefix: '/api/admin' })
    await app.register(publicRoutes, { prefix: '/api/public' })
  }, 30000)

  beforeEach(async () => {
    await db.update(schema.siteState).set({ activePublicationId: null }).where(eq(schema.siteState.id, 1))
    await db.delete(schema.publicationDocuments)
    await db.delete(schema.publicationGroups)
    await db.delete(schema.publications)
    await db.delete(schema.documents)
    await db.delete(schema.navGroups)
    await db.delete(schema.auditLogs)
    await db.insert(schema.navGroups).values([
      { id: 1, name: '教程', anchor: 'guides', sortOrder: 4 },
      { id: 2, name: '内部', anchor: 'private', isVisible: false }
    ])
    await db.insert(schema.documents).values([
      { id: 1, groupId: 1, title: '安装', navLabel: '安装', slug: 'install', markdown: '# 安装', sortOrder: 5 },
      { id: 2, groupId: 1, title: '配置', navLabel: '配置', slug: 'config', markdown: '# 配置', sortOrder: 9 },
      { id: 3, groupId: 1, title: '隐藏', navLabel: '隐藏', slug: 'hidden', markdown: '内部', isVisible: false },
      { id: 4, groupId: 2, title: '内部', navLabel: '内部', slug: 'private', markdown: '内部' }
    ])
    const response = await publish()
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ unchanged: false, documentCount: 2 })
    currentId = response.json().id
  })

  afterAll(async () => { await app.close(); await pool?.end() })

  it('returns the current version on repeated publish and leaves audit history and ETag unchanged', async () => {
    const before = await app.inject('/api/public/site')
    const response = await publish()
    expect(response.json()).toEqual({ id: currentId, documentCount: 2, unchanged: true })
    expect(await db.select().from(schema.publications)).toHaveLength(1)
    expect(await db.select().from(schema.auditLogs)).toHaveLength(1)
    const after = await app.inject('/api/public/site')
    expect(after.headers.etag).toBe(before.headers.etag)
    expect((await status()).changes.hasChanges).toBe(false)
  })

  it('ignores timestamps, hidden drafts, hidden groups and equivalent sort positions', async () => {
    await db.update(schema.documents).set({ updatedAt: new Date(), sortOrder: 0 }).where(eq(schema.documents.id, 1))
    await db.update(schema.documents).set({ markdown: '隐藏内容变更' }).where(eq(schema.documents.id, 3))
    await db.update(schema.documents).set({ markdown: '隐藏分组内变更' }).where(eq(schema.documents.id, 4))
    await db.update(schema.navGroups).set({ sortOrder: 0 }).where(eq(schema.navGroups.id, 1))
    expect((await status()).changes.hasChanges).toBe(false)
    expect((await publish()).json().unchanged).toBe(true)
  })

  it('updates one article while preserving the date of untouched legacy articles', async () => {
    const oldDate = new Date('2026-01-02T00:00:00Z')
    await db.update(schema.publications).set({ createdAt: oldDate }).where(eq(schema.publications.id, currentId))
    await db.update(schema.publicationDocuments).set({ contentUpdatedAt: null })
    await db.update(schema.documents).set({ markdown: '# 新内容' }).where(eq(schema.documents.id, 1))
    expect((await status()).changes.updated).toEqual([{ id: 1, title: '安装' }])
    expect((await publish()).json().unchanged).toBe(false)
    const site = (await app.inject('/api/public/site')).json()
    expect(site.groups[0].documents[0].updatedAt).not.toBe(oldDate.toISOString())
    expect(site.groups[0].documents[1].updatedAt).toBe(oldDate.toISOString())
  })

  it('publishes settings or navigation changes without changing article dates', async () => {
    const before = (await app.inject('/api/public/site')).json().groups[0].documents
    await db.update(schema.siteSettings).set({ subtitle: '新的站点说明' }).where(eq(schema.siteSettings.id, 1))
    await db.update(schema.documents).set({ sortOrder: -1 }).where(eq(schema.documents.id, 2))
    expect((await status()).changes).toMatchObject({ settingsChanged: true, navigationChanged: true, updated: [] })
    await publish()
    const after = (await app.inject('/api/public/site')).json().groups[0].documents
    expect(after.map((doc: { slug: string }) => doc.slug)).toEqual(['config', 'install'])
    expect(after[0].updatedAt).toBe(before[1].updatedAt)
    expect(after[1].updatedAt).toBe(before[0].updatedAt)
  })

  it('creates only one version when two changed-content publishes arrive concurrently', async () => {
    await db.update(schema.documents).set({ markdown: '并发发布' }).where(eq(schema.documents.id, 1))
    const responses = await Promise.all([publish(), publish()])
    expect(responses.map((res) => res.statusCode)).toEqual([200, 200])
    expect(responses.map((res) => res.json().unchanged).sort()).toEqual([false, true])
    expect(responses[0].json().id).toBe(responses[1].json().id)
    expect(await db.select().from(schema.publications)).toHaveLength(2)
  })

  it('handles hide, reveal and restore against the active version', async () => {
    await db.update(schema.documents).set({ isVisible: false }).where(eq(schema.documents.id, 1))
    expect((await status()).changes.removed).toEqual([{ id: 1, title: '安装' }])
    await publish()
    await db.update(schema.documents).set({ isVisible: true }).where(eq(schema.documents.id, 1))
    expect((await status()).changes.added).toEqual([{ id: 1, title: '安装' }])
    await publish()
    await app.inject({ method: 'POST', url: `/api/admin/publications/${currentId}/restore`, headers })
    expect((await status()).changes.hasChanges).toBe(false)
  })
  it('serves lean navigation, protected document endpoints, search and conditional responses', async () => {
    const nav = await app.inject('/api/public/navigation')
    expect(nav.json().groups.flatMap((g: any) => g.documents).map((d: any) => d.slug)).toEqual(['install','config'])
    expect(nav.json().groups[0].documents[0]).not.toHaveProperty('html')
    expect(nav.json().groups[0].documents[0]).not.toHaveProperty('searchText')
    const conditional = await app.inject({url:'/api/public/navigation',headers:{'if-none-match':nav.headers.etag!}})
    expect(conditional.statusCode).toBe(304)
    expect(conditional.headers.etag).toBe(nav.headers.etag)
    for (const validator of [`W/${nav.headers.etag}`, `"old-version", W/${nav.headers.etag}`, '*']) {
      expect((await app.inject({url:'/api/public/navigation',headers:{'if-none-match':validator}})).statusCode).toBe(304)
    }
    expect((await app.inject({url:'/api/public/navigation',headers:{'if-none-match':'W/"different-version"'}})).statusCode).toBe(200)
    for (const slug of ['hidden','private','missing']) expect((await app.inject('/api/public/documents/'+slug)).statusCode).toBe(404)
    const detail = (await app.inject('/api/public/documents/install')).json()
    expect(detail.document.html).toContain('安装')
    await db.update(schema.documents).set({markdown:'## 连接排错\n\n连接超时，检查网络'}).where(eq(schema.documents.id,1))
    expect((await app.inject('/api/public/search?q='+encodeURIComponent('连接超时'))).json().results).toEqual([])
    await publish()
    const fresh = await app.inject('/api/public/navigation')
    expect(fresh.headers.etag).not.toBe(nav.headers.etag)
    const search = (await app.inject('/api/public/search?q='+encodeURIComponent('连接超时'))).json()
    expect(search.results[0]).toMatchObject({slug:'install',anchor:'install--连接排错'})
    expect(search.publication.id).toBe(fresh.json().publication.id)
  })

})
