import type { CatalogGroup, CatalogPool, PublicCatalog } from './types.js'
import { compareModelOrder } from './order.js'

export function accountPool(group: CatalogGroup, platform: string, key?: string): CatalogPool | undefined {
  const pools = group.mode === 'subscription' ? group.pools?.filter(p => p.platform === platform) || [] : []
  return key ? pools.find(p => p.key === key) : pools.find(p => p.isDefault) || pools[0]
}

export function availableAccountPools(catalog: PublicCatalog, platform: string, groupId = ''): CatalogPool[] {
  const pools = new Map<string, CatalogPool>()
  for (const g of catalog.groups) {
    if (g.mode !== 'subscription' || (groupId && !g.sourceIds.includes(groupId))) continue
    for (const p of g.pools || []) if (p.platform === platform && !pools.has(p.key)) pools.set(p.key, p)
  }
  return [...pools.values()]
}

export function poolModels(group: CatalogGroup, platform: string, key?: string) {
  if (group.mode !== 'subscription' || !group.pools) return key ? [] : group.models.filter(m => m.platform === platform)
  return accountPool(group, platform, key)?.models || []
}

// A missing selected pool must not fall back to another pool's models or prices.
export function withAccountPools(catalog: PublicCatalog, selections: Record<string, string | undefined> = {}): PublicCatalog {
  return { ...catalog, groups: catalog.groups.map(g => {
    if (g.mode !== 'subscription' || !g.pools) return g
    const platforms = [...new Set(g.pools.map(p => p.platform))]
    const pools = platforms.flatMap(platform => accountPool(g, platform, selections[platform]) || [])
    return { ...g, models: pools.flatMap(p => p.models).sort(compareModelOrder),
      platformRates: { ...g.platformRates, ...Object.fromEntries(pools.map(p => [p.platform, Number(p.rate)])) } }
  }) }
}
