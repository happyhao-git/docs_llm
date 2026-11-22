import { describe, expect, it } from 'vitest'
import { buildSnapshot, initialSettings, publicCatalog } from './catalog.js'
import { calculateItems, decimal, multiply, rateFor, serviceTierItems, tieredItems } from './pricing.js'
import { modelSourceFixture as fixture } from '../../tests/fixtures/model-source.js'

describe('pricing math and catalog', () => {
  it('keeps currency conversion decimal-exact and never treats missing prices as zero', () => {
    expect(multiply('2.667', '0.03')).toBe('0.08001')
    expect(decimal(null)).toBeNull(); expect(decimal('')).toBeNull(); expect(decimal('NaN')).toBeNull(); expect(decimal('-1')).toBeNull(); expect(decimal(0)).toBe('0')
    const items = calculateItems({ input_cost_per_token: 0.00001 }, { input_cost_per_token: 0.00001 }, undefined, '4', '0.02')
    expect(items[0]).toMatchObject({ official: '10', base: '10', final: '0.8', coefficient: '0.08' })
    expect(items.find(i => i.key === 'output')?.final).toBeNull()
  })
  it('uses platform overrides as replacement and independent image rates', () => {
    const g = { rate_multiplier: 2.667, platform_rate_multipliers: { anthropic: 4 }, image_rate_independent: true, image_rate_multiplier: 1 }
    expect(rateFor(g, 'anthropic', 'text')).toBe('4'); expect(rateFor(g, 'openai', 'text')).toBe('2.667'); expect(rateFor(g, 'openai', 'image')).toBe('1')
  })
  it('excludes internal models and test groups, merges equivalent subscription plans', () => {
    const source = fixture(), settings = initialSettings(source), snapshot = buildSnapshot(source, settings), catalog = publicCatalog(snapshot, settings)
    expect(catalog.groups.map(g => g.id)).toEqual(['12', '67', '26'])
    expect(catalog.groups[1].sourceIds).toEqual(['67', '78'])
    expect(catalog.groups[0].models.some(m => m.id.startsWith('__'))).toBe(false)
    expect(catalog.groups[0].models.find(m => m.id === 'gpt-example')?.items[0].final).toBe('0.8')
    expect(catalog.groups[1].models.find(m => m.id === 'gpt-example')?.items[0].final).toBe('0.8001')
    expect(catalog.groups[2].models.find(m => m.id === 'gpt-example')?.items[0].final).toBe('2')
  })
  it('only enforces enabled allowlists and preserves different support scopes', () => {
    const s = fixture(); s.groups[2].model_allowlist = { enabled: true, models: ['gpt-*'] }
    const settings = initialSettings(s), catalog = publicCatalog(buildSnapshot(s, settings), settings)
    expect(catalog.groups.filter(g => g.platform === 'composite')).toHaveLength(2)
    expect(catalog.groups.find(g => g.id === '78')?.models.map(m => m.id)).toEqual(['gpt-example'])
    expect(new Set(catalog.groups.map(g => g.name)).size).toBe(catalog.groups.length)
  })
  it('keeps official price separate from configured channel billing', () => {
    const s = fixture(); s.channels = [{ id: 1, group_id: '12', billing_model_source: 'requested' }]
    s.prices = [{ id: 1, channel_id: 1, platform: 'openai', models: ['gpt-example'], input_price: '0.00002', output_price: '0.00004', billing_mode: 'token' }]
    const settings = initialSettings(s), model = buildSnapshot(s, settings).groups[0].models.find(m => m.id === 'gpt-example')!
    expect(model.customPricing).toBe(true); expect(model.items[0]).toMatchObject({ official: '10', base: '20', final: '1.6' })
  })
  it('preserves the count-billing switch for non-OpenAI image models', () => {
    const s = fixture(); s.mappings[0].mapping = { 'gemini-image-example': 'gemini-image-example' }; s.mappings[0].platform = 'gemini'
    s.official['gemini-image-example'] = { mode: 'image_generation', input_cost_per_token: '0.000005', output_cost_per_image_token: '0.00003' }
    Object.assign(s.groups[0], { platform: 'gemini', image_rate_independent: true, image_rate_multiplier: 1, image_price_1k: 3, image_count_billing: false })
    const settings = initialSettings(s)
    let m = buildSnapshot(s, settings).groups[0].models[0]
    expect(m.items.find(i => i.key === 'imageOutput')).toMatchObject({ base: '30', final: '0.9', unit: '百万图片 tokens' })
    expect(m.items.some(i => i.key === 'image-1k')).toBe(false)
    s.groups[0].image_count_billing = true; m = buildSnapshot(s, settings).groups[0].models[0]
    expect(m.items[0]).toMatchObject({ base: '3', final: '0.09', unit: '张' })
    expect(m.items[1].final).toBeNull()
  })
  it('supports long context and disables it when the group says so', () => {
    const s = fixture(), settings = initialSettings(s)
    let m = buildSnapshot(s, settings).groups[0].models.find(m => m.id === 'gpt-example')!
    expect(m.items.find(i => i.key === 'input-above-272k')?.final).toBe('1.6')
    s.groups[0].long_context_pricing_enabled = false
    m = buildSnapshot(s, settings).groups[0].models.find(m => m.id === 'gpt-example')!
    expect(m.items.some(i => i.condition)).toBe(false)
  })
  it('recalculates exchange rules immediately without changing the source snapshot', () => {
    const s = fixture(), settings = initialSettings(s), snapshot = buildSnapshot(s, settings)
    settings.exchange.openaiSubscription = '0.04'
    expect(publicCatalog(snapshot, settings).groups[0].models.find(m => m.id === 'gpt-example')?.items[0].final).toBe('1.6')
    expect(snapshot.groups[0].models.find(m => m.id === 'gpt-example')?.items[0].final).toBe('0.8')
  })
  it('applies long-context input ratios to channel overrides and both cache TTLs', () => {
    const s = fixture(), settings = initialSettings(s)
    Object.assign(s.official['gpt-example'], { cache_creation_input_token_cost: '0.0000125', cache_creation_input_token_cost_above_1hr: '0.00002' })
    s.channels = [{ id: 1, group_id: '12', billing_model_source: 'requested' }]
    s.prices = [{ id: 1, channel_id: 1, platform: 'openai', models: ['gpt-example'], input_price: '0.00002', cache_write_price: '0.00003', billing_mode: 'token' }]
    const model = buildSnapshot(s, settings).groups[0].models.find(m => m.id === 'gpt-example')!
    expect(model.items.find(i => i.key === 'input-above-272k')).toMatchObject({ official: '20', base: '40', final: '3.2' })
    expect(model.items.find(i => i.key === 'cacheRead-above-272k')).toMatchObject({ base: '2', final: '0.16' })
    expect(model.items.find(i => i.key === 'cacheWrite-above-272k')?.base).toBe('60')
    expect(model.items.find(i => i.key === 'cacheWrite1h-above-272k')?.base).toBe('60')
    s.intervals = [{ id: 1, pricing_id: 1, min_tokens: 200000, input_price: '0.00005' }]
    expect(buildSnapshot(s, settings).groups[0].models[0].items.some(i => i.key.includes('-above-'))).toBe(false)
  })
  it('honors explicit long-context metadata and its disabling values', () => {
    const card = { input_cost_per_token: '0.00001', long_context_input_token_threshold: 200000, long_context_input_cost_multiplier: 2, litellm_provider: 'xai' }
    expect(tieredItems(card, card, '4', '0.02')[0]).toMatchObject({ final: '1.6', condition: '输入达到 200K tokens（含缓存）' })
    expect(tieredItems(card, { ...card, long_context_input_token_threshold: 0, input_cost_per_token_above_272k_tokens: '0.00003' }, '4', '0.02')).toEqual([])
  })
  it('marks stale snapshots and guards unknown billing rules', () => {
    const s = fixture(), settings = initialSettings(s), snapshot = buildSnapshot(s, settings, new Date(0))
    expect(publicCatalog(snapshot, settings).stale).toBe(true)
    expect(calculateItems({}, {}, { billing_mode: 'unknown' }, '4', '0.02')).toEqual([])
    expect(calculateItems({}, {}, { billing_mode: 'per_request', per_request_price: '2' }, '4', '0.02')[0]).toMatchObject({ unit: '次', final: '0.16' })
  })
  it('preserves cache-write override semantics and explicit Fast/Flex ratios', () => {
    const prices = { input_cost_per_token: '0.00001', input_cost_per_token_priority: '0.00002', output_cost_per_token: '0.00002', output_cost_per_token_priority: '0.00004', cache_creation_input_token_cost_above_1hr: '0.00003' }
    const channel = { input_price: '0.00003', cache_write_price: '0.00004' }
    expect(calculateItems(prices, prices, channel, '4', '0.02').find(i => i.key === 'cacheWrite1h')?.base).toBe('40')
    expect(serviceTierItems(prices, prices, channel, '4', '0.02').find(i => i.key === 'input-priority')).toMatchObject({ official: '20', base: '60', final: '4.8' })
    expect(serviceTierItems({}, {}, undefined, '4', '0.02')).toEqual([])
  })
})
