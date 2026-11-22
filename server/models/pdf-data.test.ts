import { describe, expect, it } from 'vitest'
import { buildPriceExport, exportCatalogHash, priceExportSchema } from './pdf-data.js'
import { priceCatalog } from '../../tests/fixtures/price-export.js'

describe('price export selection', () => {
  it('preserves supplied order and explicit groups, including unavailable-mode rows', () => {
    const catalog = priceCatalog()
    const data = buildPriceExport(catalog, { catalogHash: exportCatalogHash(catalog), billing: 'subscription', showRelease: false, rows: [
      { platform: 'openai', modelId: 'image-test', groupId: '67' }, { platform: 'openai', modelId: 'gpt-test', groupId: '12' },
      { platform: 'deepseek', modelId: 'deepseek-test', groupId: null }
    ] }, 'https://docs.gs88.shop')
    expect(data.rows.map(row => row.model.id)).toEqual(['image-test', 'gpt-test', 'deepseek-test'])
    expect(data.rows.map(row => row.group?.id)).toEqual(['67', '12', undefined])
    expect(data.rows[2].model.items).toEqual([])
    expect(data.rows[0].model.items[1].final).toBe('0.0798')
  })
  it('detects price and visibility changes even when the sync timestamp is unchanged', () => {
    const catalog = priceCatalog(), hash = exportCatalogHash(catalog)
    catalog.stale = true
    expect(exportCatalogHash(catalog)).toBe(hash)
    const request = { catalogHash: hash, billing: 'subscription' as const, showRelease: false, rows: [{ platform: 'openai', modelId: 'gpt-test', groupId: '12' }] }
    catalog.groups[0].models[0].items[0].final = '0.16'
    expect(() => buildPriceExport(catalog, request, 'https://docs.gs88.shop')).toThrow('价格表已更新')
    catalog.groups.shift()
    expect(() => buildPriceExport(catalog, { ...request, catalogHash: exportCatalogHash(catalog) }, 'https://docs.gs88.shop')).toThrow('价格表已更新')
  })
  it('does not substitute prices from a different billing mode or accept duplicate rows', () => {
    const catalog = priceCatalog()
    const request = { catalogHash: exportCatalogHash(catalog), billing: 'subscription' as const, showRelease: false,
      rows: [{ platform: 'openai', modelId: 'gpt-test', groupId: '26' as string | null }] }
    expect(() => buildPriceExport(catalog, request, 'https://docs.gs88.shop')).toThrow()
    request.rows[0].groupId = null
    expect(() => buildPriceExport(catalog, request, 'https://docs.gs88.shop')).toThrow()
    request.rows[0].groupId = '12'; request.rows.push({ ...request.rows[0] })
    expect(() => buildPriceExport(catalog, request, 'https://docs.gs88.shop')).toThrow('重复')
    expect(priceExportSchema.safeParse({ ...request, rows: [] }).success).toBe(false)
  })
})
