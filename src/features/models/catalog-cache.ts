import type { CatalogRefreshResult, PublicCatalog } from './types'
import { MODEL_SYNC_INTERVAL_MS } from '../../../server/models/policy'

export const CATALOG_CACHE_KEY = 'linkapi:model-catalog:v10'
export const CATALOG_FRESH_TTL = MODEL_SYNC_INTERVAL_MS
export const CATALOG_CACHE_TTL = 6 * CATALOG_FRESH_TTL
export const CATALOG_REQUEST_TIMEOUT = 12_000
export const CATALOG_REFRESH_TIMEOUT = 30_000
const MAX_STORED_LENGTH = 1_000_000
type Snapshot = { savedAt: number; catalog: PublicCatalog }
type CacheStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function localStorageOrNull(): CacheStorage | null {
  try { return window.localStorage } catch { return null }
}

// Validate both the public response and optional browser storage before rendering
// prices. A corrupt/obsolete snapshot must never break the page or invent a price.
function isCatalog(value: unknown): value is PublicCatalog {
  const text = (v: unknown) => typeof v === 'string'
  const decimal = (v: unknown) => text(v) && /^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(v as string) && Number.isFinite(Number(v))
  const nullablePrice = (v: unknown) => v === null || decimal(v)
  const validModels = (models: PublicCatalog['groups'][number]['models']) => Array.isArray(models) && models.every(m => text(m.id) && text(m.platform)
          && ['text', 'image', 'video', 'audio', 'embedding', 'other'].includes(m.kind)
          && typeof m.customPricing === 'boolean' && Array.isArray(m.notes) && m.notes.every(text)
          && (m.officialSource === null || text(m.officialSource))
          && (m.releasedAt == null || (text(m.releasedAt) && /^\d{4}-\d{2}-\d{2}$/.test(m.releasedAt) && Number.isFinite(Date.parse(m.releasedAt))))
          && (m.releaseSource == null || text(m.releaseSource))
          && Array.isArray(m.items) && m.items.every(i => text(i.key) && text(i.label) && text(i.unit)
            && nullablePrice(i.official) && nullablePrice(i.base) && nullablePrice(i.final)
            && (i.officialCurrency === undefined || ['CNY', 'USD'].includes(i.officialCurrency))
            && decimal(i.rate) && decimal(i.coefficient) && (i.condition === undefined || text(i.condition))))
  try {
    const c = value as PublicCatalog
    return !!c && text(c.updatedAt) && Number.isFinite(Date.parse(c.updatedAt)) && text(c.pricingUpdatedAt) && typeof c.stale === 'boolean'
      && Array.isArray(c.platforms) && c.platforms.every(p => text(p.id) && text(p.name) && Number.isFinite(p.count))
      && Array.isArray(c.groups) && c.groups.every(g => text(g.id) && text(g.name) && text(g.platform)
        && ['subscription', 'balance'].includes(g.mode) && Array.isArray(g.sourceIds) && g.sourceIds.every(text)
        && decimal(g.rate) && decimal(g.cnyPerCredit) && typeof g.isDefault === 'boolean'
        && !!g.platformRates && typeof g.platformRates === 'object' && Object.values(g.platformRates).every(n => typeof n === 'number' && Number.isFinite(n))
        && validModels(g.models)
        && (g.pools === undefined || (Array.isArray(g.pools) && g.pools.every(p => text(p.key) && text(p.name) && text(p.platform)
          && decimal(p.rate) && typeof p.isDefault === 'boolean' && validModels(p.models)))))
  } catch { return false }
}

export class CatalogCache {
  private snapshot: Snapshot | null = null
  private restored = false
  private pending: Promise<PublicCatalog> | null = null
  private pendingRefresh: Promise<CatalogRefreshResult> | null = null
  private generation = 0

  constructor(private fetcher: typeof fetch = (input, init) => fetch(input, init), private storage: () => CacheStorage | null = localStorageOrNull) {}

  invalidate(persist = true) {
    this.generation++
    this.snapshot = null
    this.restored = false
    this.pending = null
    this.pendingRefresh = null
    if (persist) try { this.storage()?.removeItem(CATALOG_CACHE_KEY) } catch { /* Optional storage. */ }
  }

  peek(): PublicCatalog | null {
    if (!this.restored) {
      this.restored = true
      try {
        const raw = this.storage()?.getItem(CATALOG_CACHE_KEY)
        if (raw && raw.length <= MAX_STORED_LENGTH) {
          const saved = JSON.parse(raw) as Snapshot
          if (typeof saved?.savedAt === 'number' && isCatalog(saved.catalog)) this.snapshot = saved
        }
      } catch { /* Storage is optional, including private/restricted browsing. */ }
    }
    const age = this.snapshot ? Date.now() - this.snapshot.savedAt : Infinity
    if (age < 0 || age >= CATALOG_CACHE_TTL) {
      this.snapshot = null
      try { this.storage()?.removeItem(CATALOG_CACHE_KEY) } catch { /* Optional storage. */ }
    }
    return this.snapshot?.catalog ?? null
  }

  load(force = false): Promise<PublicCatalog> {
    if (this.pending) return this.pending
    if (this.pendingRefresh) return this.pendingRefresh.then(result => result.catalog)
    const cached = this.peek()
    // Fresh snapshots also survive reloads, new tabs and browser restarts. Older
    // snapshots remain displayable briefly while a conditional request refreshes them.
    if (!force && cached && this.snapshot) {
      // Do not give a nearly hour-old server snapshot another full fresh hour.
      // A short grace period also coalesces visits while the scheduled sync runs.
      const sourceAgeWhenSaved = Math.max(0, this.snapshot.savedAt - Date.parse(cached.updatedAt))
      const freshFor = Math.max(60_000, CATALOG_FRESH_TTL - sourceAgeWhenSaved)
      if (Date.now() - this.snapshot.savedAt < freshFor) return Promise.resolve(cached)
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), CATALOG_REQUEST_TIMEOUT)
    const generation = this.generation
    const pending: Promise<PublicCatalog> = (async () => {
      try {
        const response = await this.fetcher('/api/public/models', { signal: controller.signal, credentials: 'same-origin', cache: 'no-cache' })
        if (!response.ok) throw new Error('模型列表暂时无法加载，请重试。')
        const catalog: unknown = await response.json()
        if (!isCatalog(catalog)) throw new Error('模型数据暂时不可用，请重试。')
        // A settings save may invalidate an older in-flight response.
        if (generation !== this.generation) return this.load()
        this.save(catalog)
        return catalog
      } catch (error) {
        if (generation !== this.generation) return this.load()
        if (controller.signal.aborted) throw new Error('加载超时，请重试。')
        if (error instanceof TypeError) throw new Error('连接失败，请重试。')
        throw error
      } finally {
        clearTimeout(timeout)
      }
    })().finally(() => { if (this.pending === pending) this.pending = null })
    this.pending = pending
    return this.pending
  }

  private save(catalog: PublicCatalog) {
    this.snapshot = { savedAt: Date.now(), catalog }
    try {
      const serialized = JSON.stringify(this.snapshot)
      if (serialized.length <= MAX_STORED_LENGTH) this.storage()?.setItem(CATALOG_CACHE_KEY, serialized)
      else this.storage()?.removeItem(CATALOG_CACHE_KEY)
    } catch { /* Optional storage. */ }
  }

  refresh(): Promise<CatalogRefreshResult> {
    if (this.pendingRefresh) return this.pendingRefresh
    const prior = this.pending
    const pending = (async (): Promise<CatalogRefreshResult> => {
      // A click must still reach the refresh endpoint if a background GET was
      // already in flight, and that older GET must not overwrite the result.
      if (prior) await prior.catch(() => undefined)
      const generation = this.generation, controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), CATALOG_REFRESH_TIMEOUT)
      try {
        const response = await this.fetcher('/api/public/models/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
          signal: controller.signal, credentials: 'same-origin', cache: 'no-store' })
        if (!response.ok) throw new Error(response.status === 429 ? '刷新较频繁，请稍后重试。' : '模型列表暂时无法更新，请稍后重试。')
        const result = await response.json() as CatalogRefreshResult
        if (!isCatalog(result?.catalog) || !['updated', 'cooldown', 'failed', 'busy'].includes(result.status)
          || !Number.isInteger(result.retryAfterSeconds) || result.retryAfterSeconds < 0 || result.retryAfterSeconds > 3600) throw new Error('模型数据暂时不可用，请重试。')
        if (generation !== this.generation) return { ...result, catalog: await this.load(true) }
        this.save(result.catalog)
        return result
      } catch (error) {
        if (controller.signal.aborted) throw new Error('更新超时，请稍后重试。')
        if (error instanceof TypeError) throw new Error('连接失败，请重试。')
        throw error
      } finally { clearTimeout(timeout) }
    })().finally(() => { if (this.pendingRefresh === pending) this.pendingRefresh = null })
    this.pendingRefresh = pending
    return pending
  }
}

export const modelCatalog = new CatalogCache()
