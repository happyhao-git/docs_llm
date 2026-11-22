import { createHash } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAdmin, verifyCsrf } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import type { ModelCatalogService } from '../models/service.js'
import { config } from '../config.js'
import { modelExportRoutes } from './model-export.js'
const cost = z.string().regex(/^\d+(\.\d{1,12})?$/).refine(v => Number(v) > 0 && Number(v) <= 1000)
export const plazaSettingsSchema = z.object({
  exchange: z.object({ balance: cost, openaiSubscription: cost, otherSubscription: cost }),
  groups: z.array(z.object({ id: z.string().regex(/^\d+$/), visible: z.boolean(), name: z.string().trim().max(120), order: z.number().int().min(0).max(100000), isDefault: z.boolean() })).max(5000)
})
export function modelRoutes(service: ModelCatalogService): FastifyPluginAsync {
  return async app => {
    app.register(modelExportRoutes(service))
    app.get('/public/models', async (request, reply) => {
      const catalog = service.getPublic()
      if (!catalog) return reply.code(503).header('Retry-After', '30').header('Cache-Control', 'no-store').send({ error: '模型数据暂不可用，请稍后重试' })
      const serialized = JSON.stringify(catalog), etag = `"${createHash('sha256').update(serialized).digest('base64url')}"`
      reply.header('Cache-Control', 'public, max-age=0, must-revalidate').header('ETag', etag)
      if (String(request.headers['if-none-match'] || '').split(',').some(v => v.trim() === '*' || v.trim().replace(/^W\//, '') === etag)) return reply.code(304).send()
      return reply.type('application/json; charset=utf-8').send(serialized)
    })
    app.post('/public/models/refresh', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      if (request.headers['sec-fetch-site'] === 'cross-site' || (request.headers.origin && request.headers.origin !== new URL(config.appOrigin).origin)) {
        return reply.code(403).send({ error: '请从模型广场刷新列表。' })
      }
      const synced = await service.sync()
      const catalog = service.getPublic(), failed = !!service.getAdmin().status.error
      const retryAfterSeconds = service.retryAfterSeconds() || (synced ? 0 : 3)
      if (retryAfterSeconds) reply.header('Retry-After', String(retryAfterSeconds))
      if (!catalog) return reply.code(503).send({ error: '模型列表暂时无法更新，请稍后重试。', retryAfterSeconds })
      return { catalog, status: synced ? 'updated' : failed ? 'failed' : service.retryAfterSeconds() > 0 ? 'cooldown' : 'busy', retryAfterSeconds }
    })
    app.register(async admin => {
      admin.addHook('preHandler', requireAdmin); admin.addHook('preHandler', verifyCsrf)
      admin.get('/models', async (_request, reply) => reply.header('Cache-Control', 'no-store').send(service.getAdmin()))
      admin.put('/models/settings', async request => {
        if (service.getAdmin().status.syncing) throw Object.assign(new Error('同步进行中，请完成后保存'), { statusCode: 409 })
        await service.saveSettings(plazaSettingsSchema.parse(request.body))
        await audit(request.admin!.id, 'update', 'model_plaza_settings', 1)
        return service.getAdmin()
      })
      admin.post('/models/sync', { config: { rateLimit: { max: 4, timeWindow: '1 minute' } } }, async request => {
        const synced = await service.sync()
        if (!synced && !service.getAdmin().status.error) throw Object.assign(new Error(service.retryAfterSeconds() ? `请在 ${service.retryAfterSeconds()} 秒后再次同步` : '配置保存中，请稍后同步'), { statusCode: 409 })
        await audit(request.admin!.id, 'sync', 'model_plaza', 1)
        return service.getAdmin()
      })
    }, { prefix: '/admin' })
  }
}
