import { Decimal } from 'decimal.js'
import { compareModelOrder } from '../../../server/models/order'
import type { BillingMode, CatalogGroup, CatalogModel, PriceItem, PublicCatalog } from './types'
import { PLATFORM_NAMES } from './types'
import { displayedFinal, hasResolutionPricing } from './presentation'

export type DirectorySort = 'platform' | 'version' | 'name' | 'released' | 'input' | 'output' | 'cacheRead' | 'image-1k' | 'image-2k' | 'image-4k'
export const directorySorts: Array<{ value: DirectorySort; label: string }> = [
  { value: 'platform', label: '平台分组' },
  { value: 'version', label: '模型版本' }, { value: 'released', label: '发布日期' }, { value: 'name', label: '模型名称' },
  { value: 'input', label: '输入价格' }, { value: 'output', label: '输出价格' }, { value: 'cacheRead', label: '缓存价格' },
  { value: 'image-1k', label: '1K 图片价格' }, { value: 'image-2k', label: '2K 图片价格' }, { value: 'image-4k', label: '4K 图片价格' }
]
export interface DirectoryRow {
  key: string; model: CatalogModel; group?: CatalogGroup; groups: CatalogGroup[]; availableModes: BillingMode[]
}
export const modelKey = (m: Pick<CatalogModel, 'platform' | 'id'>) => `${m.platform}:${m.id}`
export const standardItem = (m: CatalogModel, key: string): PriceItem | undefined => m.items.find(i => i.key === key && !i.condition)

export function directoryRows(catalog: PublicCatalog, mode: BillingMode, selected: Record<string, string> = {}, groupId = ''): DirectoryRow[] {
  const identities = new Map<string, CatalogModel>()
  for (const g of catalog.groups) for (const m of g.models) if (!identities.has(modelKey(m))) identities.set(modelKey(m), m)
  return [...identities].flatMap(([key, identity]) => {
    const available = catalog.groups.filter(g => g.models.some(m => modelKey(m) === key))
    const groups = available.filter(g => g.mode === mode)
    if (groupId && !groups.some(g => g.sourceIds.includes(groupId))) return []
    const group = groups.find(g => g.sourceIds.includes(groupId || selected[key]))
      || groups.find(g => g.isDefault) || groups.find(g => g.platform === identity.platform) || groups[0]
    return [{ key, model: group?.models.find(m => modelKey(m) === key) || { ...identity, items: [] }, group, groups,
      availableModes: [...new Set(available.map(g => g.mode))] }]
  })
}

export function comparablePrice(row: DirectoryRow, sort: DirectorySort, mode: BillingMode): string | null {
  const model = row.model
  if (sort.startsWith('image-') ? !hasResolutionPricing(model) : !['text', 'embedding'].includes(model.kind)) return null
  const item = standardItem(model, sort)
  if (!item || item.final === null) return null
  return sort.startsWith('image-') ? item.final : displayedFinal(item, mode)
}

export function sortDirectory(rows: DirectoryRow[], sort: DirectorySort, direction: 'asc' | 'desc', mode: BillingMode): DirectoryRow[] {
  const sign = direction === 'asc' ? 1 : -1
  const platforms = Object.keys(PLATFORM_NAMES)
  const rank = (id: string) => platforms.includes(id) ? platforms.indexOf(id) : platforms.length
  const platformOrder = (a: DirectoryRow, b: DirectoryRow) => rank(a.model.platform) - rank(b.model.platform) || a.model.platform.localeCompare(b.model.platform)
  return [...rows].sort((a, b) => {
    if (sort === 'platform') return platformOrder(a, b) * sign || compareModelOrder(a.model, b.model)
    if (sort === 'version') {
      // Version sequences only have meaning within the same vendor and family.
      if (a.model.platform !== b.model.platform) return platformOrder(a, b)
      const review = Number(/(?:^|[-_.])review(?:$|[-_.])/i.test(a.model.id)) - Number(/(?:^|[-_.])review(?:$|[-_.])/i.test(b.model.id))
      if (review) return review
      return compareModelOrder(a.model, b.model) * -sign
    }
    if (sort === 'name') return a.model.id.localeCompare(b.model.id, 'en', { numeric: true }) * sign || a.key.localeCompare(b.key)
    const left = sort === 'released' ? a.model.releasedAt ?? null : comparablePrice(a, sort, mode)
    const right = sort === 'released' ? b.model.releasedAt ?? null : comparablePrice(b, sort, mode)
    if (left === null || right === null) {
      if (left !== right) return left === null ? 1 : -1
    } else {
      const difference = sort === 'released' ? left.localeCompare(right) : new Decimal(left).cmp(right)
      if (difference) return difference * sign
    }
    return compareModelOrder(a.model, b.model) || a.key.localeCompare(b.key)
  })
}
