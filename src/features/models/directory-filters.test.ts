import { describe, expect, it } from 'vitest'
import { directoryPoolFixture } from '../../../tests/fixtures/directory-pools'
import { directoryFilters, directoryPoolCatalog } from './directory-filters'
import { directoryRows } from './directory'
import { buildPriceExport, exportCatalogHash } from '../../../server/models/pdf-data'

describe('directory vendor and pool selections', () => {
  it('keeps all vendors independent of OpenAI and scopes vendor choices to the selected group and billing mode', () => {
    const c = directoryPoolFixture()
    const all = directoryFilters(c, 'subscription', { group: '67' })
    expect(all.vendor).toBe(''); expect(all.pools).toEqual([]); expect(all.selectedPool).toBeUndefined()
    expect(all.vendors.map(p => p.id)).toEqual(['openai', 'anthropic', 'grok', 'deepseek'])
    expect(directoryFilters(c, 'subscription', { group: '12' }).vendors.map(p => p.id)).toEqual(['openai'])
    expect(directoryFilters(c, 'balance', {}).vendors.map(p => p.id)).toEqual(['openai', 'anthropic'])
  })

  it('keeps the group when choosing vendors and normalizes invalid or legacy links', () => {
    const c = directoryPoolFixture()
    const selected = directoryFilters(c, 'subscription', { group: '67', vendor: 'anthropic' })
    expect(selected.groupId).toBe('67'); expect(selected.selectedPool?.key).toBe('claude-default')
    expect(selected.groups.map(g => g.id)).toEqual(['12', '67', '44', '65'])
    expect(directoryFilters(c, 'subscription', { group: '67', pool: 'claude-pro' }).query).toEqual({ group: '67', vendor: 'anthropic', pool: 'claude-pro' })
    expect(directoryFilters(c, 'subscription', { group: '12', vendor: 'anthropic', pool: 'claude-pro' }).query).toEqual({ group: '12', vendor: undefined, pool: undefined })
    expect(directoryFilters(c, 'subscription', { group: '67', vendor: 'deepseek', pool: 'claude-pro' }).selectedPool?.key).toBe('deepseek-default')
    expect(directoryFilters(c, 'subscription', { group: 'gone', vendor: 'gone', pool: 'gone' }).query).toEqual({ group: undefined, vendor: undefined, pool: undefined })
    expect(directoryFilters(c, 'balance', { vendor: 'openai', pool: 'openai-official' }).query.pool).toBeUndefined()
  })

  it('handles single and absent pools without inventing choices', () => {
    const c = directoryPoolFixture()
    expect(directoryFilters(c, 'subscription', { group: '67', vendor: 'grok' }).pools.map(p => p.key)).toEqual(['grok-only'])
    expect(directoryFilters(c, 'subscription', { group: '65', vendor: 'grok' }).pools).toEqual([])
    expect(directoryFilters(c, 'subscription', { group: '65', vendor: 'grok', pool: 'grok-only' }).query.pool).toBeUndefined()
  })

  it('uses each vendor default in all-vendor mode and excludes unrelated group prices when a pool is chosen', () => {
    const c = directoryPoolFixture(), defaults = directoryPoolCatalog(c, {})
    const rows = directoryRows(defaults, 'subscription', {}, '67')
    expect(rows.map(r => r.model.id)).not.toContain('gpt-official')
    expect(rows.find(r => r.model.id === 'claude-test')?.model.items[0].final).toBe('0.12')
    expect(rows.find(r => r.model.id === 'deepseek-test')?.model.items[0].final).toBe('0.12')
    const chosen = directoryRows(directoryPoolCatalog(c, { grok: 'grok-only' }), 'subscription').find(r => r.model.id === 'grok-test')!
    expect(chosen.group?.id).toBe('67')
    expect(chosen.groups.map(g => g.id)).toEqual(['67'])
    expect(chosen.model.items[0].final).toBe('0.21')
    const pdf = buildPriceExport(c, { billing: 'subscription', catalogHash: exportCatalogHash(c), showRelease: false,
      rows: [{ platform: 'grok', modelId: 'grok-test', groupId: chosen.group!.id, poolKey: 'grok-only' }] }, 'https://docs.gs88.shop')
    expect(pdf.rows[0].model.items[0].final).toBe(chosen.model.items[0].final)
    expect(pdf.rows[0].group?.name).toContain('Grok【企业】')
    expect(c.groups.find(g => g.id === '65')?.models[0].items[0].final).toBe('0.02')
  })
})
