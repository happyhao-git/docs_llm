import { describe, expect, it } from 'vitest'
import { accountPoolSource } from '../../tests/fixtures/account-pools.js'
import { buildSnapshot, initialSettings, publicCatalog } from './catalog.js'
import { accountPool, availableAccountPools, withAccountPools } from './account-pools.js'
import { displayedFinal } from './presentation.js'
import { buildPriceExport, exportCatalogHash } from './pdf-data.js'

function fixture() {
  const source = accountPoolSource(), settings = initialSettings(source)
  return { source, settings, catalog: publicCatalog(buildSnapshot(source, settings), settings) }
}

describe('subscription account pools', () => {
  it('uses each pool’s members and replacement multiplier with equal displayed costs across subscriptions', () => {
    const { catalog } = fixture()
    const openai = catalog.groups.find(g => g.id === '12')!, combined = catalog.groups.find(g => g.id === '67')!
    expect(combined.sourceIds).toEqual(['67', '78'])
    expect(openai.pools).toHaveLength(3)
    for (const [index, pool] of openai.pools!.entries()) {
      const other = accountPool(combined, 'openai', pool.key)!
      const model = pool.models.find(m => m.id === 'gpt-example')!, same = other.models.find(m => m.id === model.id)!
      expect(model.items[0].coefficient).toBe(['0.08', '0.16', '0.3'][index])
      expect(displayedFinal(model.items[0], 'subscription')).toBe(displayedFinal(same.items[0], 'subscription'))
      expect(model.items.find(i => i.condition)?.rate).toBe(pool.rate)
      expect(pool.models.some(m => m.id === 'unknown-model')).toBe(false)
      expect(pool.models.some(m => m.id === 'gpt-official-only')).toBe(index === 2)
      expect(pool.models.find(m => m.kind === 'image')?.items[0]).toMatchObject({ rate: '1', final: '0.06' })
    }
    expect(catalog.groups.find(g => g.id === '26')?.pools).toBeUndefined()
  })

  it('defaults to Plus, preserves a pool across groups and never substitutes unavailable pools', () => {
    const { catalog } = fixture(), pools = availableAccountPools(catalog, 'openai')
    expect(pools).toHaveLength(3)
    const selected = withAccountPools(catalog)
    expect(selected.groups.find(g => g.id === '67')?.models.some(m => m.id === 'gpt-official-only')).toBe(false)
    for (const g of withAccountPools(catalog, { openai: pools[2].key }).groups.filter(g => g.pools)) {
      expect(g.models.some(m => m.id === 'gpt-official-only')).toBe(true)
      expect(g.models[0].items[0].coefficient).toBe('0.3')
    }
    expect(withAccountPools(catalog, { openai: 'removed-pool' }).groups.find(g => g.id === '12')?.models).toEqual([])
    expect(catalog.groups.find(g => g.id === '12')?.models.length).toBeGreaterThan(0)
  })

  it('preserves pool differences when merging plans and recomputes prices after exchange changes', () => {
    const { source, settings } = fixture()
    source.pools!.find(p => p.id === '78-1')!.rate_multiplier = 6
    const snapshot = buildSnapshot(source, settings)
    expect(publicCatalog(snapshot, settings).groups.some(g => g.id === '78')).toBe(true)
    settings.exchange.openaiSubscription = '0.04'
    const changed = publicCatalog(snapshot, settings).groups.find(g => g.id === '12')!
    expect(changed.pools![1].models[0].items[0].coefficient).toBe('0.32')
    expect(snapshot.groups.find(g => g.id === '12')!.pools![1].models[0].items[0].coefficient).toBe('0.16')
  })

  it('exports the selected pool’s prices and label, rejecting unsupported or removed selections', () => {
    const { catalog } = fixture(), pools = availableAccountPools(catalog, 'openai', '12')
    const request = { catalogHash: exportCatalogHash(catalog), billing: 'subscription' as const, showRelease: false,
      rows: [{ platform: 'openai', modelId: 'gpt-example', groupId: '12', poolKey: pools[1].key }] }
    const data = buildPriceExport(catalog, request, 'https://docs.gs88.shop')
    expect(data.rows[0].group?.name).toContain('ChatGPT-Pro【企业稳定】')
    expect(data.rows[0].model.items[0].coefficient).toBe('0.16')
    request.rows[0].modelId = 'gpt-official-only'
    expect(() => buildPriceExport(catalog, request, 'https://docs.gs88.shop')).toThrow('价格表已更新')
    request.rows[0].poolKey = pools[2].key
    expect(buildPriceExport(catalog, request, 'https://docs.gs88.shop').rows[0].model.items[0].coefficient).toBe('0.3')
    request.rows[0].poolKey = 'removed-pool'
    expect(() => buildPriceExport(catalog, request, 'https://docs.gs88.shop')).toThrow('价格表已更新')
  })

  it('keeps enabled-but-empty pool configurations empty rather than using unrelated group members', () => {
    const { source, settings } = fixture()
    source.poolMappings = []
    expect(buildSnapshot(source, settings).groups.find(g => g.id === '12')?.models).toEqual([])
    source.pools = []
    expect(buildSnapshot(source, settings).groups.find(g => g.id === '12')?.models).toEqual([])
  })
})
