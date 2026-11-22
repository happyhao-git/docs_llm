import { availableAccountPools, withAccountPools } from '../../../server/models/account-pools'
import type { BillingMode, PublicCatalog } from './types'

export function directoryFilters(catalog: PublicCatalog, mode: BillingMode, requested: { group?: unknown; vendor?: unknown; pool?: unknown }) {
  const groups = catalog.groups.filter(g => g.mode === mode)
  const groupId = groups.some(g => g.sourceIds.includes(String(requested.group))) ? String(requested.group) : ''
  const scope = groupId ? groups.filter(g => g.sourceIds.includes(groupId)) : groups
  const supported = new Set(scope.flatMap(g => [...g.models.map(m => m.platform), ...(g.pools || []).map(p => p.platform)]))
  const vendors = catalog.platforms.filter(p => supported.has(p.id))
  // Old shared links selected a pool without a vendor. Make that vendor explicit.
  const legacyPool = mode === 'subscription' && requested.vendor === undefined
    ? scope.flatMap(g => g.pools || []).find(p => p.key === requested.pool) : undefined
  const candidate = requested.vendor ?? legacyPool?.platform
  const vendor = vendors.some(p => p.id === candidate) ? String(candidate) : ''
  const pools = mode === 'subscription' && vendor ? availableAccountPools(catalog, vendor, groupId) : []
  const explicitPool = pools.find(p => p.key === requested.pool)
  const selectedPool = explicitPool || pools.find(p => p.isDefault) || pools[0]
  return { groups, groupId, vendors, vendor, pools, selectedPool,
    query: { group: groupId || undefined, vendor: vendor || undefined, pool: explicitPool?.key } }
}

export function directoryPoolCatalog(catalog: PublicCatalog, selections: Record<string, string | undefined>): PublicCatalog {
  const selected = withAccountPools(catalog, selections)
  return { ...selected, groups: selected.groups.map(g => {
    if (g.mode !== 'subscription') return g
    // A group without the chosen pool cannot supply that pool's quote.
    return { ...g, models: g.models.filter(m => !selections[m.platform]
      || g.pools?.some(p => p.platform === m.platform && p.key === selections[m.platform])) }
  }) }
}
