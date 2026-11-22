import type { FastifyPluginAsync } from 'fastify'
import { config } from '../config.js'
import type { ModelCatalogService } from '../models/service.js'
import { buildPriceExport, priceExportSchema } from '../models/pdf-data.js'
import { PricePdfPool } from '../models/pdf-pool.js'
import { PricePdfCache, pricePdfKey } from '../models/pdf-cache.js'

export function modelExportRoutes(service: Pick<ModelCatalogService, 'getPublic'>, pdf: Pick<PricePdfPool, 'generate' | 'close'> = new PricePdfPool()): FastifyPluginAsync {
  return async app => {
    const cache = new PricePdfCache(pdf)
    app.addHook('onClose', async () => { cache.close(); await pdf.close() })
    app.post('/public/models/export.pdf', { bodyLimit: 256_000, config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      if (request.headers['sec-fetch-site'] === 'cross-site' || (request.headers.origin && request.headers.origin !== new URL(config.appOrigin).origin)) {
        return reply.code(403).send({ error: '请从模型广场导出价格表。' })
      }
      const parsed = priceExportSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: '导出内容无效，请重新选择模型。' })
      const catalog = service.getPublic()
      if (!catalog) return reply.code(503).header('Retry-After', '30').send({ error: '价格暂不可用，请稍后重试。' })
      try {
        const started = performance.now()
        const data = buildPriceExport(catalog, parsed.data, config.appOrigin)
        const key = pricePdfKey(parsed.data, config.appOrigin)
        const cached = cache.get(key)
        reply.header('X-Price-Pdf-Key', key)
        if (cached && parsed.data.cachedPdf === key) {
          // The browser already has these exact bytes. A small validated response
          // avoids retransmitting the document, while still checking current prices.
          return reply.header('X-Price-Pdf-Cache', 'client').header('Server-Timing', `pdf;dur=${(performance.now() - started).toFixed(1)}`).code(204).send()
        }
        const { pdf: file, state } = await cache.generate(key, data)
        const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(file.generatedAt)).replaceAll('-', '')
        const name = `AiLink-价格表-${data.billing === 'subscription' ? '订阅' : '余额'}-${day}.pdf`
        return reply.type('application/pdf').header('X-Content-Type-Options', 'nosniff')
          .header('X-Price-Pdf-Cache', state).header('Server-Timing', `pdf;dur=${(performance.now() - started).toFixed(1)}`)
          .header('Content-Disposition', `attachment; filename="AiLink-prices-${data.billing}-${day}.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`).send(file.bytes)
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode
        if (status === 409) return reply.code(409).send({ code: 'catalog_changed', error: '价格表已更新，请重新导出。' })
        if (status === 400) return reply.code(400).send({ error: (error as Error).message })
        request.log.error({ err: error }, 'Price PDF export failed')
        return reply.code(503).header('Retry-After', '5').send({ error: '暂时无法导出，请稍后重试。' })
      }
    })
  }
}
