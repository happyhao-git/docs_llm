import { describe, expect, it, vi } from 'vitest'
import { PricePdfCache, pricePdfKey, PDF_CACHE_TTL } from './pdf-cache.js'
import { exportCatalogHash } from './pdf-data.js'
import { priceCatalog } from '../../tests/fixtures/price-export.js'

const catalog = priceCatalog()
const request = { catalogHash: exportCatalogHash(catalog), billing: 'balance' as const, rows: [{ platform: 'openai', modelId: 'gpt-test', groupId: '26' }], showRelease: false, showPlatform: true }
const data = { billing: 'balance' as const, updatedAt: catalog.updatedAt, pricingUpdatedAt: catalog.pricingUpdatedAt,
  generatedAt: '2026-11-05T01:00:00.000Z', rows: [], showRelease: false, showPlatform: true, origin: 'https://docs.ailink1.com' }

describe('PDF reuse', () => {
  it('coalesces simultaneous exports and expires saved bytes', async () => {
    let now = 0, complete!: (buffer: Buffer) => void
    const renderer = { generate: vi.fn(() => new Promise<Buffer>(resolve => { complete = resolve })) }
    const cache = new PricePdfCache(renderer, () => now), key = pricePdfKey(request, data.origin)
    const first = cache.generate(key, data), second = cache.generate(key, data)
    await Promise.resolve(); complete(Buffer.from('%PDF-1.7\ntest'))
    expect((await first).state).toBe('miss')
    expect((await second).state).toBe('shared')
    expect(renderer.generate).toHaveBeenCalledOnce()
    expect((await cache.generate(key, data)).state).toBe('hit')
    now = PDF_CACHE_TTL + 1
    expect(cache.get(key)).toBeUndefined()
    cache.close()
  })
  it('separates changed prices, selections and layouts', () => {
    const base = pricePdfKey(request, data.origin)
    expect(pricePdfKey({ ...request, cachedPdf: '0'.repeat(64) }, data.origin)).toBe(base)
    expect(pricePdfKey({ ...request, rows: [{ ...request.rows[0], groupId: '12' }] }, data.origin)).not.toBe(base)
    expect(pricePdfKey({ ...request, showPlatform: false }, data.origin)).not.toBe(base)
    expect(pricePdfKey({ ...request, catalogHash: '1'.repeat(64) }, data.origin)).not.toBe(base)
  })
})
