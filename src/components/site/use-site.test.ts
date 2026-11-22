// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const value = { siteName: 'LinkAPI', subtitle: '', consoleUrl: 'https://ai.gs88.shop', accentColor: '#6d4aff' }
let values: Map<string, string>
beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  values = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('public site settings cache', () => {
  it('persists a successful response and avoids requests after reloading the application', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ settings: value })))
    vi.stubGlobal('fetch', fetcher)
    const first = await import('./use-site')
    await first.useSite().loadSettings()
    vi.resetModules()
    const second = await import('./use-site')
    await second.useSite().loadSettings()
    expect(second.useSite().settings.value).toEqual(value)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('refreshes expired settings and does not cache invalid responses', async () => {
    const module = await import('./use-site')
    values.set(module.SITE_CACHE_KEY, JSON.stringify({ savedAt: Date.now() - module.SITE_CACHE_TTL, settings: value }))
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ settings: { ...value, consoleUrl: 'javascript:invalid' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ settings: value })))
    vi.stubGlobal('fetch', fetcher)
    await expect(module.useSite().loadSettings()).rejects.toThrow('暂时不可用')
    expect(module.useSite().settings.value).toBeNull()
    await module.useSite().loadSettings()
    expect(module.useSite().settings.value).toEqual(value)
  })

  it('tolerates corrupt or blocked storage and shares concurrent requests', async () => {
    const module = await import('./use-site')
    values.set(module.SITE_CACHE_KEY, '{broken')
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ settings: value })))
    vi.stubGlobal('fetch', fetcher)
    await Promise.all([module.useSite().loadSettings(), module.useSite().loadSettings()])
    expect(fetcher).toHaveBeenCalledTimes(1)
    vi.resetModules()
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Blocked') }, setItem: () => { throw new Error('Blocked') } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ settings: value }))))
    const reloaded = await import('./use-site')
    await reloaded.useSite().loadSettings()
    expect(reloaded.useSite().settings.value).toEqual(value)
  })
})
