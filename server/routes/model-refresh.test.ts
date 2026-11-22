import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { modelRoutes } from './models.js'
import type { ModelCatalogService } from '../models/service.js'
import { buildSnapshot, initialSettings, publicCatalog } from '../models/catalog.js'
import { modelSourceFixture } from '../../tests/fixtures/model-source.js'

describe('public catalog refresh response', () => {
  it('keeps GET snapshot-only and returns the refreshed snapshot with cooldown metadata', async () => {
    const source = modelSourceFixture(), settings = initialSettings(source), catalog = publicCatalog(buildSnapshot(source, settings), settings)
    const service = { getPublic: vi.fn(() => catalog), sync: vi.fn(async () => true), retryAfterSeconds: () => 60, getAdmin: () => ({ status: { error: null } }) }
    const app = Fastify(); await app.register(modelRoutes(service as unknown as ModelCatalogService), { prefix: '/api' })
    try {
      const read = await app.inject({ method: 'GET', url: '/api/public/models' })
      expect(read.statusCode).toBe(200); expect(service.sync).not.toHaveBeenCalled()
      const refreshed = await app.inject({ method: 'POST', url: '/api/public/models/refresh', payload: {} })
      expect(refreshed.statusCode).toBe(200)
      expect(refreshed.headers['cache-control']).toBe('no-store')
      expect(refreshed.headers['retry-after']).toBe('60')
      expect(refreshed.json()).toEqual({ catalog, status: 'updated', retryAfterSeconds: 60 })
      service.sync.mockResolvedValue(false)
      expect((await app.inject({ method: 'POST', url: '/api/public/models/refresh', payload: {} })).json()).toMatchObject({ catalog, status: 'cooldown' })
    } finally { await app.close() }
  })

  it('keeps the last snapshot after failure and reports an unavailable catalog without internal errors', async () => {
    const source = modelSourceFixture(), settings = initialSettings(source), catalog = publicCatalog(buildSnapshot(source, settings), settings)
    const service = { getPublic: vi.fn(() => ({ ...catalog, stale: true }) as typeof catalog | null), sync: vi.fn(async () => false), retryAfterSeconds: () => 42, getAdmin: () => ({ status: { error: 'internal connection information' } }) }
    const app = Fastify(); await app.register(modelRoutes(service as unknown as ModelCatalogService), { prefix: '/api' })
    try {
      const failed = await app.inject({ method: 'POST', url: '/api/public/models/refresh', payload: {} })
      expect(failed.json()).toMatchObject({ catalog: { stale: true }, status: 'failed', retryAfterSeconds: 42 })
      expect(failed.body).not.toContain('internal connection information')
      service.getPublic.mockReturnValue(null)
      const empty = await app.inject({ method: 'POST', url: '/api/public/models/refresh', payload: {} })
      expect(empty.statusCode).toBe(503); expect(empty.headers['retry-after']).toBe('42')
    } finally { await app.close() }
  })
})
