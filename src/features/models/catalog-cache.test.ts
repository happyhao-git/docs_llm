import { afterEach, describe, expect, it, vi } from 'vitest'
import { CatalogCache, CATALOG_CACHE_KEY, CATALOG_CACHE_TTL, CATALOG_FRESH_TTL, CATALOG_REQUEST_TIMEOUT, CATALOG_REFRESH_TIMEOUT } from './catalog-cache'
import type { PublicCatalog } from './types'
import { buildSnapshot, initialSettings, publicCatalog } from '../../../server/models/catalog'
import { modelSourceFixture } from '../../../tests/fixtures/model-source'
import { accountPoolSource } from '../../../tests/fixtures/account-pools'

function fixture() {
  const source = modelSourceFixture(), settings = initialSettings(source)
  return publicCatalog(buildSnapshot(source, settings), settings)
}
const json = (catalog: PublicCatalog) => new Response(JSON.stringify(catalog))
function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}
afterEach(() => vi.useRealTimers())

describe('public model catalog cache', () => {
  it('validates pool prices and restores all pool choices without another request', async () => {
    const source = accountPoolSource(), settings = initialSettings(source)
    const catalog = publicCatalog(buildSnapshot(source, settings), settings), saved = storage()
    const fetcher = vi.fn().mockResolvedValue(json(catalog))
    saved.setItem('linkapi:model-catalog:v8', JSON.stringify({ savedAt: Date.now(), catalog: fixture() }))
    const cache = new CatalogCache(fetcher, () => saved)
    expect(cache.peek()).toBeNull()
    await cache.load()
    expect(await new CatalogCache(fetcher, () => saved).load()).toEqual(catalog)
    expect(fetcher).toHaveBeenCalledTimes(1)
    catalog.groups[0].pools![0].models[0].items[0].final = 'invalid'
    saved.setItem(CATALOG_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), catalog }))
    expect(new CatalogCache(fetcher, () => saved).peek()).toBeNull()
  })
  it('only explicit refresh requests synchronize, replacing removed models in memory and storage', async () => {
    const original = fixture(), changed = fixture(), saved = storage()
    changed.groups = []; changed.platforms = []
    const result = { catalog: changed, status: 'updated', retryAfterSeconds: 60 }
    const fetcher = vi.fn().mockResolvedValueOnce(json(original)).mockResolvedValueOnce(json(original)).mockResolvedValueOnce(new Response(JSON.stringify(result)))
    const cache = new CatalogCache(fetcher, () => saved)
    await cache.load(); await cache.load(true)
    expect(fetcher.mock.calls.every(args => args[0] === '/api/public/models' && !args[1].method)).toBe(true)
    const first = cache.refresh(), concurrent = cache.refresh()
    expect(first).toBe(concurrent)
    expect(await first).toEqual(result)
    expect(fetcher.mock.calls[2]).toMatchObject(['/api/public/models/refresh', { method: 'POST', credentials: 'same-origin', cache: 'no-store' }])
    expect(cache.peek()?.groups).toEqual([])
    expect(new CatalogCache(fetcher, () => saved).peek()?.groups).toEqual([])
  })

  it('waits for an earlier GET before refreshing so old rows cannot overwrite a removal', async () => {
    let release!: (value: Response) => void
    const original = fixture(), changed = { ...fixture(), groups: [], platforms: [] }
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { release = done }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ catalog: changed, status: 'updated', retryAfterSeconds: 60 })))
    const cache = new CatalogCache(fetcher, () => null)
    const loading = cache.load(), refreshing = cache.refresh()
    expect(fetcher).toHaveBeenCalledTimes(1)
    release(json(original)); await loading; await refreshing
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(cache.peek()?.groups).toEqual([])
  })

  it('accepts cooldown snapshots, preserves stale data after failed synchronization and times out safely', async () => {
    vi.useFakeTimers()
    const original = fixture(), stale = { ...original, stale: true }
    const fetcher = vi.fn().mockResolvedValueOnce(json(original))
      .mockResolvedValueOnce(new Response(JSON.stringify({ catalog: original, status: 'cooldown', retryAfterSeconds: 40 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ catalog: stale, status: 'failed', retryAfterSeconds: 60 })))
      .mockImplementationOnce((_url: string, options: RequestInit) => new Promise((_resolve, reject) => { options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))) }))
    const cache = new CatalogCache(fetcher, () => null)
    await cache.load()
    expect(await cache.refresh()).toMatchObject({ status: 'cooldown', retryAfterSeconds: 40 })
    expect(await cache.refresh()).toMatchObject({ status: 'failed', catalog: { stale: true } })
    const timedOut = expect(cache.refresh()).rejects.toThrow('更新超时')
    await vi.advanceTimersByTimeAsync(CATALOG_REFRESH_TIMEOUT)
    await timedOut
    expect(cache.peek()).toEqual(stale)
  })

  it('invalidates old USD references and validates currency metadata with legacy USD compatibility', async () => {
    const saved = storage(), value = fixture()
    saved.setItem('linkapi:model-catalog:v4', JSON.stringify({ savedAt: Date.now(), catalog: value }))
    const fetcher = vi.fn().mockResolvedValue(json(value)), cache = new CatalogCache(fetcher, () => saved)
    expect(cache.peek()).toBeNull()
    await cache.load()
    expect(fetcher).toHaveBeenCalledTimes(1)
    for (const currency of ['CNY', 'USD', undefined, 'EUR'] as const) {
      const c = fixture()
      Object.assign(c.groups[0].models[0].items[0], { officialCurrency: currency })
      saved.setItem(CATALOG_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), catalog: c }))
      const restored = new CatalogCache(fetcher, () => saved).peek()
      if (currency === 'EUR') expect(restored).toBeNull()
      else expect(restored).toEqual(c)
    }
  })

  it('ignores pre-fix image prices stored under the previous cache version', async () => {
    const saved = storage(), value = fixture()
    saved.setItem('linkapi:model-catalog:v2', JSON.stringify({ savedAt: Date.now(), catalog: value }))
    const fetcher = vi.fn().mockResolvedValue(json(value)), cache = new CatalogCache(fetcher, () => saved)
    expect(cache.peek()).toBeNull()
    expect(await cache.load()).toEqual(value)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(saved.getItem(CATALOG_CACHE_KEY)).not.toBeNull()
  })

  it('invalidates cached missing Grok prices from the previous release', async () => {
    const saved = storage(), value = fixture()
    saved.setItem('linkapi:model-catalog:v3', JSON.stringify({ savedAt: Date.now(), catalog: value }))
    const fetcher = vi.fn().mockResolvedValue(json(value)), cache = new CatalogCache(fetcher, () => saved)
    expect(cache.peek()).toBeNull()
    await cache.load()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('shares the startup request with the view and avoids duplicate return-navigation requests', async () => {
    let resolve!: (response: Response) => void
    const fetcher = vi.fn(() => new Promise<Response>(done => { resolve = done }))
    const cache = new CatalogCache(fetcher, () => null), value = fixture()
    const prefetch = cache.load(), mounted = cache.load()
    expect(mounted).toBe(prefetch)
    resolve(json(value))
    expect(await prefetch).toEqual(value)
    expect(await cache.load()).toEqual(value)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]).toMatchObject(['/api/public/models', { cache: 'no-cache', credentials: 'same-origin' }])
  })

  it('reuses fresh local snapshots across reloads and tabs, then revalidates after one hour', async () => {
    vi.useFakeTimers()
    const saved = storage(), original = fixture(), updated = fixture()
    updated.groups[0].models[0].items[0].final = '99'
    const first = new CatalogCache(vi.fn().mockResolvedValue(json(original)), () => saved)
    await first.load()
    const fetcher = vi.fn().mockResolvedValue(json(updated))
    const reloaded = new CatalogCache(fetcher, () => saved)
    expect(reloaded.peek()).toEqual(original)
    expect(await reloaded.load()).toEqual(original)
    expect(fetcher).not.toHaveBeenCalled()
    expect(await new CatalogCache(fetcher, () => saved).load()).toEqual(original)
    expect(fetcher).not.toHaveBeenCalled()
    vi.advanceTimersByTime(CATALOG_FRESH_TTL)
    expect(await reloaded.load()).toEqual(updated)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(reloaded.peek()).toEqual(updated)
  })

  it('revalidates around the next source update rather than caching old prices for another full hour', async () => {
    vi.useFakeTimers()
    const value = fixture(), saved = storage()
    value.updatedAt = new Date(Date.now() - 50 * 60_000).toISOString()
    saved.setItem(CATALOG_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), catalog: value }))
    const fresh = fixture(), fetcher = vi.fn().mockResolvedValue(json(fresh))
    const cache = new CatalogCache(fetcher, () => saved)
    await cache.load()
    await vi.advanceTimersByTimeAsync(10 * 60_000 - 1)
    await cache.load()
    expect(fetcher).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await cache.load()).toEqual(fresh)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('expires snapshots and rejects future dates rather than retaining old prices indefinitely', async () => {
    vi.useFakeTimers()
    const saved = storage(), value = fixture()
    saved.setItem(CATALOG_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), catalog: value }))
    const cache = new CatalogCache(fetch, () => saved)
    expect(cache.peek()).toEqual(value)
    vi.advanceTimersByTime(CATALOG_CACHE_TTL)
    expect(cache.peek()).toBeNull()
    expect(saved.getItem(CATALOG_CACHE_KEY)).toBeNull()
    saved.setItem(CATALOG_CACHE_KEY, JSON.stringify({ savedAt: Date.now() + 1000, catalog: value }))
    expect(new CatalogCache(fetch, () => saved).peek()).toBeNull()
  })

  it('accepts authoritative empty catalogs and manual refreshes even within the deduplication window', async () => {
    const value = fixture(), empty = { ...value, groups: [], platforms: [] }
    const saved = storage(), fetcher = vi.fn().mockResolvedValueOnce(json(value)).mockResolvedValueOnce(json(empty))
    const cache = new CatalogCache(fetcher, () => saved)
    await cache.load()
    await cache.load(true)
    expect(cache.peek()).toEqual(empty)
    expect(new CatalogCache(fetcher, () => saved).peek()).toEqual(empty)
  })

  it('retains known data after a failed refresh without extending its lifetime, and permits retry', async () => {
    vi.useFakeTimers()
    const value = fixture(), saved = storage()
    const fetcher = vi.fn().mockResolvedValueOnce(json(value)).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(json(value))
    const cache = new CatalogCache(fetcher, () => saved)
    await cache.load()
    const snapshot = saved.getItem(CATALOG_CACHE_KEY)
    vi.advanceTimersByTime(CATALOG_FRESH_TTL + 1)
    await expect(cache.load()).rejects.toThrow('连接失败')
    expect(cache.peek()).toEqual(value)
    expect(saved.getItem(CATALOG_CACHE_KEY)).toBe(snapshot)
    await cache.load(true)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('aborts hanging requests, reports a timeout and releases the request for retry', async () => {
    vi.useFakeTimers()
    let signal!: AbortSignal
    const fetcher = vi.fn().mockImplementationOnce((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = options.signal!
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })).mockResolvedValueOnce(json(fixture()))
    const cache = new CatalogCache(fetcher, () => null)
    const failed = expect(cache.load()).rejects.toThrow('加载超时')
    await vi.advanceTimersByTimeAsync(CATALOG_REQUEST_TIMEOUT)
    await failed
    expect(signal.aborted).toBe(true)
    expect(cache.peek()).toBeNull()
    expect((await cache.load()).groups.length).toBeGreaterThan(0)
  })

  it('discards corrupt or incompatible persisted values and tolerates disabled storage', async () => {
    const saved = storage()
    for (const raw of ['{broken', JSON.stringify({ savedAt: Date.now(), catalog: { groups: [null] } })]) {
      saved.setItem(CATALOG_CACHE_KEY, raw)
      expect(new CatalogCache(fetch, () => saved).peek()).toBeNull()
    }
    const cache = new CatalogCache(vi.fn().mockResolvedValue(json(fixture())), () => { throw new Error('Storage disabled') })
    expect(cache.peek()).toBeNull()
    expect((await cache.load()).groups.length).toBeGreaterThan(0)
  })

  it('does not cache HTTP errors or invalid numeric values', async () => {
    const invalid = fixture()
    invalid.groups[0].models[0].items[0].coefficient = 'invalid'
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(json(invalid)).mockResolvedValueOnce(json(fixture()))
    const cache = new CatalogCache(fetcher, () => null)
    await expect(cache.load()).rejects.toThrow('暂时无法加载')
    await expect(cache.load()).rejects.toThrow('模型数据暂时不可用')
    expect(cache.peek()).toBeNull()
    await expect(cache.load()).resolves.toBeTruthy()
  })

  it('invalidates after settings changes and never restores an older in-flight response', async () => {
    const saved = storage(), original = fixture(), updated = fixture()
    updated.groups[0].models[0].items[0].final = '99'
    let finishOld!: (response: Response) => void
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { finishOld = done })).mockResolvedValueOnce(json(updated))
    const cache = new CatalogCache(fetcher, () => saved)
    const old = cache.load()
    cache.invalidate()
    expect(cache.peek()).toBeNull()
    expect(await cache.load()).toEqual(updated)
    finishOld(json(original))
    expect(await old).toEqual(updated)
    expect(cache.peek()).toEqual(updated)
    expect(fetcher).toHaveBeenCalledTimes(2)
    cache.invalidate()
    expect(saved.getItem(CATALOG_CACHE_KEY)).toBeNull()
  })
})
