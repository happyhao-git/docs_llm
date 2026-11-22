import type { BillingMode, PublicCatalog } from './types.js'

export interface ExportSelection { platform: string; modelId: string; groupId: string | null; poolKey?: string }
export interface PriceExportRequest {
  billing: BillingMode
  catalogHash: string
  rows: ExportSelection[]
  showRelease: boolean
  showPlatform?: boolean
  cachedPdf?: string
}

// Exclude transient health state; include settings-derived prices and group visibility.
// The browser hashes exactly the same JSON as the server, without sending prices.
export function exportCatalogContent(catalog: PublicCatalog): string {
  return JSON.stringify({ updatedAt: catalog.updatedAt, pricingUpdatedAt: catalog.pricingUpdatedAt,
    platforms: catalog.platforms, groups: catalog.groups })
}
