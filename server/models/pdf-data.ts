import { createHash } from 'node:crypto'
import { z } from 'zod'
import { exportCatalogContent, type PriceExportRequest } from './export-contract.js'
import type { BillingMode, CatalogGroup, CatalogModel, PublicCatalog } from './types.js'
import { accountPool, poolModels } from './account-pools.js'

export const priceExportSchema = z.object({
  billing: z.enum(['subscription', 'balance']),
  catalogHash: z.string().regex(/^[a-f0-9]{64}$/),
  rows: z.array(z.object({ platform: z.string().min(1).max(80), modelId: z.string().min(1).max(500),
    groupId: z.string().min(1).max(200).nullable(), poolKey: z.string().min(1).max(200).optional() }).strict()).min(1).max(500),
  showRelease: z.boolean().default(false),
  showPlatform: z.boolean().default(false),
  cachedPdf: z.string().regex(/^[a-f0-9]{64}$/).optional()
}).strict()

export interface PriceExportRow { model: CatalogModel; group: Pick<CatalogGroup, 'id' | 'name' | 'cnyPerCredit'> | null }
export interface PriceExportData {
  billing: BillingMode; updatedAt: string; pricingUpdatedAt: string; generatedAt: string
  rows: PriceExportRow[]; showRelease: boolean; showPlatform?: boolean; origin: string
}

export const exportCatalogHash = (catalog: PublicCatalog) => createHash('sha256').update(exportCatalogContent(catalog)).digest('hex')
const changed = () => Object.assign(new Error('价格表已更新，请重新导出。'), { statusCode: 409 })

export function buildPriceExport(catalog: PublicCatalog, request: PriceExportRequest, origin: string, now = new Date()): PriceExportData {
  if (request.catalogHash !== exportCatalogHash(catalog)) throw changed()
  const seen = new Set<string>()
  const rows = request.rows.map(selection => {
    const key = `${selection.platform}:${selection.modelId}`
    if (seen.has(key)) throw Object.assign(new Error('模型列表存在重复项。'), { statusCode: 400 })
    seen.add(key)
    const matches = (m: CatalogModel) => m.platform === selection.platform && m.id === selection.modelId
    if (selection.groupId === null) {
      // Rows unavailable in this billing mode remain visible, without borrowing another mode's prices.
      if (catalog.groups.some(g => g.mode === request.billing && poolModels(g, selection.platform, selection.poolKey).some(matches))) throw changed()
      const model = catalog.groups.flatMap(g => g.models).find(matches)
      if (!model) throw changed()
      return { model: { ...model, items: [] }, group: null }
    }
    const group = catalog.groups.find(g => g.id === selection.groupId && g.mode === request.billing)
    const model = group && poolModels(group, selection.platform, selection.poolKey).find(matches)
    if (!group || !model) throw changed()
    const pool = accountPool(group, selection.platform, selection.poolKey)
    return { model, group: { id: group.id, name: pool ? `${group.name} · ${pool.name}` : group.name, cnyPerCredit: group.cnyPerCredit } }
  })
  return { billing: request.billing, updatedAt: catalog.updatedAt, pricingUpdatedAt: catalog.pricingUpdatedAt,
    generatedAt: now.toISOString(), rows, showRelease: request.showRelease, showPlatform: !!request.showPlatform, origin: new URL(origin).origin }
}
