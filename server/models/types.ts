export type ModelKind = 'text' | 'image' | 'video' | 'audio' | 'embedding' | 'other'
export type BillingMode = 'subscription' | 'balance'
export interface PriceItem {
  key: string; label: string; unit: string
  official: string | null; base: string | null; final: string | null
  officialCurrency?: 'CNY' | 'USD'
  rate: string; coefficient: string; condition?: string
}
export interface CatalogModel {
  id: string; platform: string; kind: ModelKind; items: PriceItem[]
  releasedAt?: string | null; releaseSource?: string | null
  customPricing: boolean; notes: string[]; officialSource: string | null
}
export interface CatalogGroup {
  id: string; sourceIds: string[]; name: string; platform: string; mode: BillingMode
  rate: string; platformRates: Record<string, number>; cnyPerCredit: string
  isDefault: boolean; models: CatalogModel[]
  pools?: CatalogPool[]
}
export interface CatalogPool {
  key: string; name: string; platform: string; rate: string; isDefault: boolean; models: CatalogModel[]
}
export interface GroupSetting {
  id: string; visible: boolean; name: string; order: number; isDefault: boolean
}
export interface PlazaSettings {
  groups: GroupSetting[]
  exchange: { balance: string; openaiSubscription: string; otherSubscription: string }
}
export interface GroupInventory {
  id: string; name: string; platform: string; mode: BillingMode; rate: string; modelCount: number
}
export interface CatalogSnapshot {
  version: 1; updatedAt: string; pricingUpdatedAt: string
  groups: CatalogGroup[]; inventory: GroupInventory[]; warnings: string[]
}
export interface PublicCatalog {
  updatedAt: string; pricingUpdatedAt: string; stale: boolean
  platforms: Array<{ id: string; name: string; count: number }>
  groups: CatalogGroup[]
}
export interface CatalogRefreshResult {
  catalog: PublicCatalog
  status: 'updated' | 'cooldown' | 'failed' | 'busy'
  retryAfterSeconds: number
}
export interface PlazaAdmin {
  settings: PlazaSettings; inventory: GroupInventory[]
  status: { syncing: boolean; syncIntervalMinutes: number; lastAttemptAt: string | null; lastSuccessAt: string | null; error: string | null; warnings: string[] }
}
export const PLATFORM_NAMES: Record<string, string> = {
  openai: 'OpenAI', anthropic: 'Claude', grok: 'Grok', gemini: 'Gemini',
  deepseek: 'DeepSeek', kimi: 'Kimi', zhipu: 'GLM', minimax: 'MiniMax',
  antigravity: 'Gemini', opencode_go: 'OpenCode', composite: '一卡通'
}
