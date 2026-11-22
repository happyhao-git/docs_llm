import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { modelExportRoutes } from './model-export.js'
import { exportCatalogHash } from '../models/pdf-data.js'
import { priceCatalog } from '../../tests/fixtures/price-export.js'

describe('public price export endpoint', () => {
  async function setup() {
    const catalog = priceCatalog(), service = { getPublic: vi.fn(() => catalog), sync: vi.fn() }
    const pdf = { generate: vi.fn(async () => Buffer.from('%PDF-1.7\nfixture')), close: vi.fn(async () => {}) }
    const app = Fastify(); await app.register(rateLimit, { global: false }); await app.register(modelExportRoutes(service, pdf), { prefix: '/api' })
    const payload = { billing: 'subscription', catalogHash: exportCatalogHash(catalog), rows: [{ platform: 'openai', modelId: 'gpt-test', groupId: '12' }] }
    const post = (body = payload) => app.inject({ method: 'POST', url: '/api/public/models/export.pdf', payload: body })
    return { app, service, pdf, catalog, payload, post }
  }
  it('downloads a PDF using only the snapshot and applies its own rate limit', async () => {
    const { app, post, service, pdf } = await setup()
    try {
      const response = await post()
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('application/pdf')
      expect(response.headers['content-disposition']).toContain("filename*=UTF-8''LinkAPI-")
      expect(response.headers['cache-control']).toBe('no-store')
      expect(pdf.generate.mock.calls[0]?.length).toBe(1)
      for (let i = 0; i < 11; i++) expect((await post()).statusCode).toBe(200)
      expect((await post()).statusCode).toBe(429)
      expect(service.sync).not.toHaveBeenCalled()
    } finally { await app.close() }
    expect(pdf.close).toHaveBeenCalledOnce()
  })
  it('reports stale prices, unavailable generation and empty selections without synchronizing', async () => {
    const { app, post, service, pdf, payload } = await setup()
    try {
      expect((await post({ ...payload, catalogHash: '0'.repeat(64) })).json()).toMatchObject({ code: 'catalog_changed' })
      expect((await post({ ...payload, rows: [] })).statusCode).toBe(400)
      expect(pdf.generate).not.toHaveBeenCalled()
      pdf.generate.mockRejectedValueOnce(new Error('internal path must not appear'))
      const failed = await post()
      expect(failed.statusCode).toBe(503); expect(failed.body).not.toContain('internal path')
      expect(service.sync).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
  it('reuses the generated PDF and returns no bytes only after verifying the current price version', async () => {
    const { app, post, service, pdf, catalog, payload } = await setup()
    try {
      const first = await post()
      const key = first.headers['x-price-pdf-key'] as string
      expect(first.headers['x-price-pdf-cache']).toBe('miss')
      const repeated = await post()
      expect(repeated.statusCode).toBe(200)
      expect(repeated.headers['x-price-pdf-cache']).toBe('hit')
      const shortcut = await post({ ...payload, cachedPdf: key })
      expect(shortcut.statusCode).toBe(204)
      expect(shortcut.body).toBe('')
      expect(shortcut.headers['x-price-pdf-key']).toBe(key)
      expect(pdf.generate).toHaveBeenCalledOnce()
      catalog.groups[0].models[0].items[0].final = '0.5'
      const changed = await post({ ...payload, cachedPdf: key })
      expect(changed.statusCode).toBe(409)
      expect(pdf.generate).toHaveBeenCalledOnce()
      expect(service.sync).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
})
