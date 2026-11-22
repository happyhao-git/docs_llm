import { describe, expect, it } from 'vitest'
import { officialPriceCard } from './official-prices.js'
import { buildSnapshot, initialSettings, publicCatalog } from './catalog.js'
import { modelSourceFixture } from '../../tests/fixtures/model-source.js'

function fixture() {
  const s = modelSourceFixture()
  s.groups = [
    { ...s.groups[0], id: '65', platform: 'grok', name: 'Grok 订阅', rate_multiplier: '7' },
    { ...s.groups[1], id: '67', platform_rate_multipliers: { grok: 7 } },
    { ...s.groups[3], id: '64', platform: 'grok', name: 'Grok-Ultra', rate_multiplier: '1.4' }
  ]
  s.mappings = s.groups.map(g => ({ group_id: g.id, platform: 'grok', mapping: { 'grok-4.7': 'grok-4.7', 'grok-unknown': 'grok-unknown' } }))
  return s
}

describe('verified local official price cards', () => {
  it('fills only the exact missing model and keeps synchronized prices authoritative', () => {
    expect(officialPriceCard('grok-4.7', {})).toMatchObject({ input_cost_per_token: '0.000002', output_cost_per_token: '0.000006', cache_read_input_token_cost: '0.0000005' })
    expect(officialPriceCard('grok-4.7-unknown', {})).toEqual({})
    const card = { input_cost_per_token: '0', output_cost_per_token: '0.000008' }
    expect(officialPriceCard('grok-4.7', { 'grok-4.7': card })).toBe(card)
    expect(officialPriceCard('grok-4.7', { 'grok-4.7': card }).cache_read_input_token_cost).toBeUndefined()
  })

  it('calculates subscription, composite and balance prices including the inclusive long-context tier', () => {
    const s = fixture(), settings = initialSettings(s), catalog = publicCatalog(buildSnapshot(s, settings), settings)
    for (const g of catalog.groups) {
      const m = g.models.find(m => m.id === 'grok-4.7')!
      const base = m.items.filter(i => !i.condition), above = m.items.filter(i => i.condition)
      expect(base.map(i => i.official)).toEqual(['2', '6', '0.5'])
      expect(base.map(i => i.final)).toEqual(g.id === '64' ? ['0.56', '1.68', '0.14'] : ['0.42', '1.26', '0.105'])
      expect(above.map(i => i.official)).toEqual(['4', '12', '1'])
      expect(above.map(i => i.final)).toEqual(g.id === '64' ? ['1.12', '3.36', '0.28'] : ['0.84', '2.52', '0.21'])
      expect(above.every(i => i.condition === '输入达到 200K tokens（含缓存）')).toBe(true)
      expect(m.customPricing).toBe(false)
      expect(m.officialSource).toBe('https://docs.x.ai/developers/models/grok-4.7')
      expect(g.models.find(m => m.id === 'grok-unknown')!.items.every(i => i.final === null)).toBe(true)
    }
  })

  it('preserves group-specific billing overrides and the long-context switch', () => {
    const s = fixture()
    s.groups[0].model_pricing = [{ models: ['grok-4.7'], billing_mode: 'token', input_price: '0.000003', output_price: '0.000009', cache_read_price: '0.000001' }]
    s.groups[0].long_context_pricing_enabled = false
    const m = buildSnapshot(s, initialSettings(s)).groups[0].models.find(m => m.id === 'grok-4.7')!
    expect(m.items.map(i => i.official)).toEqual(['2', '6', '0.5'])
    expect(m.items.map(i => i.final)).toEqual(['0.63', '1.89', '0.21'])
    expect(m.items.every(i => !i.condition)).toBe(true)
    expect(m.customPricing).toBe(true)
  })
})
