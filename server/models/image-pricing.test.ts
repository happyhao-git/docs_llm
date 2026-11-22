import { describe, expect, it } from 'vitest'
import { buildSnapshot, initialSettings, publicCatalog } from './catalog.js'
import { modelSourceFixture } from '../../tests/fixtures/model-source.js'

const imageIds = ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2.5', 'gpt-image-2', 'codex-gpt-image-2', 'gpt-image-1', 'dall-e-3', 'dall-e-2']
function fixture() {
  const s = modelSourceFixture()
  for (const g of s.groups) Object.assign(g, {
    image_count_billing: false, image_rate_independent: true, image_rate_multiplier: '1',
    image_price_1k: g.id === '26' ? '.3' : g.platform === 'composite' ? '2' : '3',
    image_price_2k: g.id === '26' ? '.4' : g.platform === 'composite' ? '2.66' : '4',
    image_price_4k: g.id === '26' ? '.5' : g.platform === 'composite' ? '3.33' : '5'
  })
  for (const m of s.mappings) for (const id of imageIds) m.mapping[id] = 'gpt-image-2'
  for (const id of imageIds) s.official[id] = {
    mode: 'image_generation', input_cost_per_token: '.000005', output_cost_per_image_token: '.00003',
    input_cost_per_token_above_272k_tokens: '.00001', source: 'https://example.com/pricing'
  }
  return s
}
describe('resolution-based OpenAI image prices', () => {
  it('uses the group prices with the count flag off, equally for every image model and alias', () => {
    const s = fixture(), settings = initialSettings(s), catalog = publicCatalog(buildSnapshot(s, settings), settings)
    for (const id of ['12', '26']) {
      const group = catalog.groups.find(g => g.id === id)!
      const images = group.models.filter(m => m.kind === 'image')
      expect(images).toHaveLength(imageIds.length)
      for (const m of images) {
        expect(m.items.map(i => i.key)).toEqual(['image-1k', 'image-2k', 'image-4k'])
        expect(m.items.map(i => i.final)).toEqual(['0.06', '0.08', '0.1'])
        expect(m.items.map(i => i.base)).toEqual(id === '12' ? ['3', '4', '5'] : ['0.3', '0.4', '0.5'])
        expect(m.items.every(i => i.unit === '张' && i.rate === '1' && i.official === null && !i.condition)).toBe(true)
        expect(m.customPricing).toBe(true); expect(m.officialSource).toBeNull()
      }
    }
    expect(catalog.groups.find(g => g.id === '12')!.models.find(m => m.id === 'gpt-example')!.items[0].final).toBe('0.8')
  })
  it('keeps composite amounts exact and honors a separate image-only group price', () => {
    const s = fixture(), settings = initialSettings(s)
    Object.assign(s.groups.find(g => g.id === '26')!, { image_price_1k: '.15', image_price_2k: '.3', image_price_4k: '.4' })
    const catalog = publicCatalog(buildSnapshot(s, settings), settings)
    expect(catalog.groups.find(g => g.id === '67')!.models.find(m => m.kind === 'image')!.items.map(i => i.final)).toEqual(['0.06', '0.0798', '0.0999'])
    expect(catalog.groups.find(g => g.id === '26')!.models.find(m => m.kind === 'image')!.items.map(i => i.final)).toEqual(['0.03', '0.06', '0.08'])
  })
  it('does not mix token overrides, intervals, routing or Fast billing into resolution prices', () => {
    const s = fixture(), g = s.groups[0]
    Object.assign(g, { model_routing_enabled: true, force_openai_fast: true, free_openai_fast: false,
      model_pricing: [{ models: ['gpt-image-*'], billing_mode: 'token', input_price: '.5' }] })
    s.channels = [{ id: 1, group_id: '12', billing_model_source: 'upstream' }]
    s.prices = [{ id: 1, channel_id: 1, models: ['gpt-image-*'], billing_mode: 'token', time_pricing: { night: 2 }, input_price: '.1' }]
    s.intervals = [{ id: 1, pricing_id: 1, min_tokens: 200000, input_price: '.2' }]
    const m = buildSnapshot(s, initialSettings(s)).groups[0].models.find(m => m.id === 'gpt-image-2')!
    expect(m.items.map(i => i.final)).toEqual(['0.06', '0.08', '0.1'])
    expect(m.items).toHaveLength(3)
  })
  it('preserves missing and invalid prices as unknown and explicit zero as zero', () => {
    const s = fixture()
    Object.assign(s.groups[0], { image_price_1k: 0, image_price_2k: null, image_price_4k: '-1' })
    const m = buildSnapshot(s, initialSettings(s)).groups[0].models.find(m => m.kind === 'image')!
    expect(m.items.map(i => i.final)).toEqual(['0', null, null])
    Object.assign(s.groups[0], { image_price_1k: null })
    expect(buildSnapshot(s, initialSettings(s)).groups[0].models.find(m => m.kind === 'image')!.items.map(i => i.final)).toEqual([null, null, null])
  })
  it('applies the image rate once and recalculates changed exchange settings', () => {
    const s = fixture(), settings = initialSettings(s)
    s.groups[0].image_rate_multiplier = '2'
    const snapshot = buildSnapshot(s, settings)
    expect(snapshot.groups[0].models.find(m => m.kind === 'image')!.items.map(i => i.final)).toEqual(['0.12', '0.16', '0.2'])
    settings.exchange.openaiSubscription = '.04'
    expect(publicCatalog(snapshot, settings).groups.find(g => g.id === '12')!.models.find(m => m.kind === 'image')!.items.map(i => i.final)).toEqual(['0.24', '0.32', '0.4'])
  })
})
