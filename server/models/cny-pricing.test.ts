import { describe, expect, it } from 'vitest'
import { buildSnapshot, initialSettings, publicCatalog } from './catalog.js'
import { cnyReferenceItems } from './cny-pricing.js'
import type { ModelSource } from './source.js'

const entries = [
  ['deepseek', 'deepseek-v4-pro', '9', '27', '0.3'],
  ['zhipu', 'glm-5.3', '8', '28', '2'],
  ['kimi', 'kimi-k3', '20', '100', '2'],
  ['kimi', 'k3', '20', '100', '2']
] as const
function fixture(): ModelSource {
  return {
    groups: [
      { id: '1', name: '余额', platform: 'composite', rate_multiplier: 1, subscription_type: 'standard' },
      { id: '2', name: '一卡通', platform: 'composite', rate_multiplier: 4, subscription_type: 'subscription' }
    ],
    mappings: ['1', '2'].flatMap(group_id => entries.map(([platform, name]) => ({ group_id, platform, mapping: { [name]: name } }))),
    channels: ['1', '2'].map(group_id => ({ id: '5', group_id, billing_model_source: 'requested' })),
    prices: entries.map(([platform, name, input, output, cache], id) => ({ id, channel_id: '5', platform, models: [name], billing_mode: 'token',
      input_price: Number(input) / 1e6, output_price: Number(output) / 1e6, cache_read_price: Number(cache) / 1e6, cache_write_price: 0 })),
    official: Object.fromEntries(entries.map(([, name]) => [name, { input_cost_per_token: '0.000001', output_cost_per_token: '0.000002', cache_read_input_token_cost: '0.0000001', source: 'https://example.com/usd' }])),
    intervals: [], routes: [], pricingUpdatedAt: '2026-11-05T00:00:00Z'
  }
}
const catalog = (s: ModelSource) => { const settings = initialSettings(s); return publicCatalog(buildSnapshot(s, settings), settings) }

describe('domestic CNY reference pricing', () => {
  it('uses channel RMB face values while retaining balance and subscription discounts', () => {
    const c = catalog(fixture())
    const expected = [
      ['deepseek-v4-pro', ['1.8', '5.4', '0.06'], ['1.08', '3.24', '0.036']],
      ['glm-5.3', ['1.6', '5.6', '0.4'], ['0.96', '3.36', '0.24']],
      ['kimi-k3', ['4', '20', '0.4'], ['2.4', '12', '0.24']],
      ['k3', ['4', '20', '0.4'], ['2.4', '12', '0.24']]
    ] as const
    for (const [name, balance, subscription] of expected) {
      for (const [group, final, coefficient] of [['1', balance, '0.2'], ['2', subscription, '0.12']] as const) {
        const model = c.groups.find(g => g.id === group)!.models.find(m => m.id === name)!
        const row = entries.find(e => e[1] === name)!
        for (const [index, key] of ['input', 'output', 'cacheRead'].entries()) {
          expect(model.items.find(i => i.key === key)).toMatchObject({ official: row[index + 2], officialCurrency: 'CNY', final: final[index], coefficient })
        }
        expect(model.officialSource).toBeNull()
      }
    }
  })

  it('keeps the channel reference separate from group billing overrides and settings', () => {
    const s = fixture()
    s.groups[0].model_pricing = [{ models: ['glm-5.3'], input_price: '0.000004' }]
    const settings = initialSettings(s), snapshot = buildSnapshot(s, settings)
    let item = publicCatalog(snapshot, settings).groups[0].models.find(m => m.id === 'glm-5.3')!.items[0]
    expect(item).toMatchObject({ official: '8', base: '4', final: '0.8', officialCurrency: 'CNY' })
    settings.exchange.balance = '0.1'
    item = publicCatalog(snapshot, settings).groups[0].models.find(m => m.id === 'glm-5.3')!.items[0]
    expect(item).toMatchObject({ official: '8', final: '0.4', officialCurrency: 'CNY' })
  })

  it('does not relabel USD prices as RMB when a channel or a field is missing', () => {
    const s = fixture()
    s.channels = s.channels.filter(c => c.group_id !== '1')
    s.prices[2].output_price = null
    const c = catalog(s)
    expect(c.groups[0].models.every(m => m.items.every(i => i.official === null && i.officialCurrency === 'CNY'))).toBe(true)
    const model = c.groups[1].models.find(m => m.id === 'kimi-k3')!
    expect(model.items.find(i => i.key === 'output')).toMatchObject({ official: null, base: '2', final: '0.24' })
    expect(model.items.find(i => i.key === 'cacheWrite')).toMatchObject({ official: '0', base: '0', final: '0' })
  })

  it('honors channel association, platform, exact matches and ambiguous references', () => {
    const s = fixture()
    s.prices.push({ ...s.prices[0], id: 90, channel_id: 'unrelated', input_price: 1 })
    s.prices.push({ ...s.prices[0], id: 91, platform: 'kimi', input_price: 2 })
    s.prices.push({ ...s.prices[0], id: 92, models: ['deepseek-*'], input_price: 3 })
    expect(catalog(s).groups[0].models.find(m => m.id === 'deepseek-v4-pro')!.items[0].official).toBe('9')
    s.prices.push({ ...s.prices[0], id: 93, input_price: 4 })
    expect(catalog(s).groups[0].models.find(m => m.id === 'deepseek-v4-pro')!.items[0]).toMatchObject({ official: null, final: null })
  })

  it('only shows tier references supported by CNY configuration', () => {
    const s = fixture()
    Object.assign(s.official['glm-5.3'], { input_cost_per_token_above_128k_tokens: '0.000002', input_cost_per_token_priority: '0.000002' })
    let model = catalog(s).groups[0].models.find(m => m.id === 'glm-5.3')!
    expect(model.items.find(i => i.key === 'input-above-128k')).toMatchObject({ official: null, final: '3.2' })
    expect(model.items.find(i => i.key === 'input-priority')).toMatchObject({ official: null, final: '3.2' })
    s.prices[1].fast_multiplier = 3
    s.intervals = [{ id: 8, pricing_id: 1, min_tokens: 128000, tier_label: '长上下文', input_multiplier: 2, output_price: '0.000056' }]
    model = catalog(s).groups[0].models.find(m => m.id === 'glm-5.3')!
    expect(model.items.find(i => i.key === 'input-tier-8')).toMatchObject({ official: '16', final: '3.2', officialCurrency: 'CNY' })
    expect(model.items.find(i => i.key === 'output-tier-8')).toMatchObject({ official: '56', final: '11.2' })
    expect(model.items.find(i => i.key === 'input-priority')).toMatchObject({ official: '24', final: '4.8' })
    Object.assign(s.groups[0], { peak_rate_enabled: true, peak_rate_multiplier: 2, peak_start: '18:00', peak_end: '22:00' })
    expect(catalog(s).groups[0].models.find(m => m.id === 'glm-5.3')!.items.find(i => i.key === 'input-peak')).toMatchObject({ official: '8', final: '3.2' })
  })

  it('keeps configured units, explicit zeroes and long-context rules', () => {
    const items = cnyReferenceItems({ billing_mode: 'token', input_price: '0.000008', cache_read_price: 0, long_context_input_token_threshold: 100000, long_context_input_cost_multiplier: 2 }, [])
    expect(items.find(i => i.key === 'input-above-100k')?.base).toBe('16')
    expect(items.find(i => i.key === 'cacheRead')?.base).toBe('0')
    expect(cnyReferenceItems({ billing_mode: 'per_request', per_request_price: '2' }, [])[0]).toMatchObject({ base: '2', unit: '次' })
    expect(cnyReferenceItems({ input_price: 1, time_pricing: { peak: 2 } }, [])).toEqual([])
  })
})
