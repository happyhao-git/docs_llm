import { describe, expect, it } from 'vitest'
import type { CatalogGroup, CatalogModel, PriceItem, PublicCatalog } from './types'
import { comparablePrice, directoryRows, sortDirectory } from './directory'

const price = (key: string, final: string | null): PriceItem => ({ key, label: key, unit: key.startsWith('image-') ? '张' : '百万 tokens', official: '10', base: '10', final, rate: '1', coefficient: '0.2' })
const model = (id: string, platform = 'openai', input: string | null = '2'): CatalogModel => ({ id, platform, kind: 'text', items: [price('input', input)], customPricing: false, notes: [], officialSource: null })
const group = (id: string, models: CatalogModel[], mode: 'balance' | 'subscription' = 'balance', isDefault = false): CatalogGroup => ({ id, name: id, models, mode, isDefault, platform: models[0]?.platform || 'openai', sourceIds: [id], rate: '1', platformRates: {}, cnyPerCredit: '0.2' })
function fixture(): PublicCatalog {
  return { updatedAt: new Date().toISOString(), pricingUpdatedAt: new Date().toISOString(), stale: false, platforms: [], groups: [
    group('pro', [model('gpt-6.1-terra', 'openai', '5'), model('gpt-5.5', 'openai', '2')]),
    group('default', [model('gpt-6.1-terra', 'openai', '3')], 'balance', true),
    group('sub', [model('gpt-6.1-terra', 'openai', '.8')], 'subscription'),
    group('kimi', [model('kimi-k3', 'kimi', '4')])
  ] }
}
describe('all-model directory', () => {
  it('deduplicates by provider and model, selects defaults and includes models unavailable in the selected mode', () => {
    const c = fixture(), balance = directoryRows(c, 'balance'), subscription = directoryRows(c, 'subscription')
    expect(balance).toHaveLength(3)
    expect(balance[0].group?.id).toBe('default')
    expect(balance[1].group?.id).toBe('pro')
    expect(balance[0].groups).toHaveLength(2)
    expect(subscription).toHaveLength(3)
    expect(subscription[1]).toMatchObject({ group: undefined, model: { items: [] }, availableModes: ['balance'] })
    expect(subscription[0].model.items[0].final).toBe('.8')
  })
  it('uses selected group prices without mutating cached models and filters exact source IDs', () => {
    const c = fixture()
    c.groups[0].sourceIds.push('pro-alias')
    const selected = directoryRows(c, 'balance', { 'openai:gpt-6.1-terra': 'pro' })
    expect(selected[0].model.items[0].final).toBe('5')
    expect(directoryRows(c, 'balance')[0].model.items[0].final).toBe('3')
    const filtered = directoryRows(c, 'balance', {}, 'pro-alias')
    expect(filtered).toHaveLength(2)
    expect(filtered.every(r => r.group?.id === 'pro')).toBe(true)
    expect(directoryRows(c, 'subscription', { 'openai:gpt-6.1-terra': 'pro' })[0].group?.id).toBe('sub')
  })
  it('keeps identical model IDs from different providers distinct', () => {
    const c = fixture(); c.groups.push(group('alternate', [model('gpt-6.1-terra', 'alternate', '1')]))
    const rows = directoryRows(c, 'balance')
    expect(rows.filter(r => r.model.id === 'gpt-6.1-terra')).toHaveLength(2)
    expect(new Set(rows.map(r => r.key)).size).toBe(4)
  })
  it('sorts prices numerically with free prices first and missing prices last in either direction', () => {
    const c = fixture(); c.groups = [group('prices', [model('a', 'openai', '10'), model('b', 'openai', '2'), model('c', 'openai', null), model('d', 'openai', '0')])]
    const rows = directoryRows(c, 'balance')
    expect(sortDirectory(rows, 'input', 'asc', 'balance').map(r => r.model.id)).toEqual(['d', 'b', 'a', 'c'])
    expect(sortDirectory(rows, 'input', 'desc', 'balance').map(r => r.model.id)).toEqual(['a', 'b', 'd', 'c'])
    expect(rows[0].model.id).toBe('a')
  })
  it('compares CNY actual costs and never mixes token, image or service-tier prices', () => {
    const c = fixture(), image = model('gpt-image-2')
    image.kind = 'image'; image.items = ['1k', '2k', '4k'].map(size => price(`image-${size}`, '.06'))
    const text = model('text', 'kimi', '4'); text.items.push(price('input-priority', '.01')); text.items[1].condition = 'Fast / Priority'
    c.groups = [group('mixed', [image, text])]
    const rows = directoryRows(c, 'balance')
    expect(comparablePrice(rows[0], 'input', 'balance')).toBeNull()
    expect(comparablePrice(rows[1], 'image-1k', 'balance')).toBeNull()
    expect(sortDirectory(rows, 'input', 'asc', 'balance')[0].model.id).toBe('text')
    expect(sortDirectory(rows, 'image-1k', 'asc', 'balance')[0].model.id).toBe('gpt-image-2')
    expect(comparablePrice(rows[1], 'input', 'balance')).toBe('4')
  })
  it('sorts release dates separately from versions and keeps unknown dates last', () => {
    const c = fixture(), older = model('gpt-9'), newer = model('gpt-2'), unknown = model('gpt-10')
    older.releasedAt = '2025-01-01'; newer.releasedAt = '2026-01-01'
    c.groups = [group('dates', [older, newer, unknown, model('codex-auto-review')])]
    const rows = directoryRows(c, 'balance')
    expect(sortDirectory(rows, 'released', 'desc', 'balance').map(r => r.model.id)).toEqual(['gpt-2', 'gpt-9', 'gpt-10', 'codex-auto-review'])
    expect(sortDirectory(rows, 'released', 'asc', 'balance').map(r => r.model.id)).toEqual(['gpt-9', 'gpt-2', 'gpt-10', 'codex-auto-review'])
    expect(sortDirectory(rows, 'version', 'desc', 'balance').map(r => r.model.id)).toEqual(['gpt-10', 'gpt-9', 'gpt-2', 'codex-auto-review'])
    expect(sortDirectory(rows, 'version', 'asc', 'balance').map(r => r.model.id)).toEqual(['gpt-2', 'gpt-9', 'gpt-10', 'codex-auto-review'])
  })
  it('groups the default list by platform and sorts versions within each platform', () => {
    const c = fixture()
    c.groups.push(group('claude', [model('claude-4', 'anthropic'), model('claude-5', 'anthropic')]))
    c.groups.push(group('grok', [model('grok-4', 'grok')]))
    const rows = directoryRows(c, 'balance')
    expect(sortDirectory(rows, 'platform', 'asc', 'balance').map(r => r.model.id))
      .toEqual(['gpt-6.1-terra', 'gpt-5.5', 'claude-5', 'claude-4', 'grok-4', 'kimi-k3'])
    expect(sortDirectory(rows, 'platform', 'desc', 'balance').map(r => r.model.platform))
      .toEqual(['kimi', 'grok', 'anthropic', 'anthropic', 'openai', 'openai'])
  })
})
