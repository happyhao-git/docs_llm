import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'mysql2/promise'
import { ModelCatalogService } from './service.js'
import { modelSourceFixture as fixture } from '../../tests/fixtures/model-source.js'
import { MODEL_SYNC_INTERVAL_MS, MODEL_SNAPSHOT_STALE_MS, MODEL_SYNC_COOLDOWN_MS } from './policy.js'
beforeEach(() => { vi.useFakeTimers({ now: new Date('2026-11-05T00:00:00Z') }) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
export function memoryPool() {
  let row: Record<string, unknown> | null = null, locked = false
  const query = vi.fn(async () => [[...(row ? [{ ...row }] : [])]])
  const execute = vi.fn(async (sql: string, values: unknown[]) => {
    if (sql.includes('snapshot_json')) row = { settings_json: values[0], snapshot_json: values[1], last_attempt_at: values[2], last_error: null }
    else if (sql.includes('settings_json')) row = { ...row, settings_json: values[0] }
    else row = { ...row, last_attempt_at: values[0], ...(values.length > 1 ? { last_error: values[1] } : {}) }
    return [{}]
  })
  return { query, execute, getConnection: vi.fn(async () => {
    let owned = false
    return { execute, query: vi.fn(async (sql: string) => {
      if (sql.includes('GET_LOCK')) { if (locked) return [[{ acquired: 0 }]]; locked = true; owned = true; return [[{ acquired: 1 }]] }
      if (sql.includes('RELEASE_LOCK')) { if (owned) locked = false; owned = false; return [[{ released: 1 }]] }
      return query()
    }), release: vi.fn(), destroy: vi.fn(() => { if (owned) locked = false }) }
  }) }
}
describe('model catalog snapshot lifecycle', () => {
  it('limits all callers to 60 attempts in a rolling hour and allows one after 60 seconds', async () => {
    const source = vi.fn(async () => fixture()), service = new ModelCatalogService(memoryPool() as unknown as Pool, source)
    await service.initialize()
    for (let minute = 0; minute < 60; minute++) {
      expect(await service.sync()).toBe(true)
      expect(service.retryAfterSeconds()).toBe(60)
      for (let caller = 0; caller < 5; caller++) expect(await service.sync()).toBe(false)
      await vi.advanceTimersByTimeAsync(59_999)
      expect(await service.sync()).toBe(false)
      expect(source).toHaveBeenCalledTimes(minute + 1)
      await vi.advanceTimersByTimeAsync(1)
    }
    expect(source).toHaveBeenCalledTimes(60)
    expect(await service.sync()).toBe(true)
    expect(source).toHaveBeenCalledTimes(61)
  })

  it('shares the limit across workers and restarts, including a sync that lasts over one minute', async () => {
    const pool = memoryPool(), source = vi.fn(async () => fixture())
    const first = new ModelCatalogService(pool as unknown as Pool, source), second = new ModelCatalogService(pool as unknown as Pool, source)
    await first.initialize(); await second.initialize()
    let finish!: (value: ReturnType<typeof fixture>) => void
    source.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const running = first.sync()
    await vi.advanceTimersByTimeAsync(0)
    expect(source).toHaveBeenCalledTimes(1)
    expect(await second.sync()).toBe(false)
    await vi.advanceTimersByTimeAsync(90_000)
    expect(await second.sync()).toBe(false)
    expect(source).toHaveBeenCalledTimes(1)
    finish(fixture()); expect(await running).toBe(true)
    expect(await second.sync()).toBe(true)
    expect(source).toHaveBeenCalledTimes(2)
    const restarted = new ModelCatalogService(pool as unknown as Pool, source)
    await restarted.initialize()
    expect(await restarted.sync()).toBe(false)
    expect(restarted.getPublic()?.updatedAt).toBe(second.getPublic()?.updatedAt)
  })

  it('persists the attempt before reading and counts failed syncs toward the cooldown', async () => {
    const pool = memoryPool(), source = vi.fn(async () => fixture()), service = new ModelCatalogService(pool as unknown as Pool, source)
    await service.initialize(); await service.sync()
    const lastSuccess = service.getPublic()?.updatedAt
    await vi.advanceTimersByTimeAsync(60_000)
    source.mockImplementationOnce(async () => {
      const restored = new ModelCatalogService(pool as unknown as Pool, source); await restored.initialize()
      expect(restored.retryAfterSeconds()).toBe(60)
      throw new Error('failure')
    })
    expect(await service.sync()).toBe(false)
    expect(service.getPublic()).toMatchObject({ updatedAt: lastSuccess, stale: true })
    expect(await service.sync()).toBe(false)
    expect(source).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await service.sync()).toBe(true)
  })

  it('cooldown clicks do not postpone the next hourly sync', async () => {
    const source = vi.fn(async () => fixture()), service = new ModelCatalogService(memoryPool() as unknown as Pool, source)
    await service.start()
    try {
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(await service.sync()).toBe(false)
      await vi.advanceTimersByTimeAsync(MODEL_SYNC_INTERVAL_MS - 30_000)
      expect(source).toHaveBeenCalledTimes(2)
    } finally { await service.close() }
  })

  it('reads the source hourly and never from repeated public visits', async () => {
    vi.useFakeTimers()
    const pool = memoryPool(), source = vi.fn(async () => fixture())
    const service = new ModelCatalogService(pool as unknown as Pool, source)
    await service.start()
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(source).toHaveBeenCalledTimes(1)
      expect(service.getAdmin().status.syncIntervalMinutes).toBe(60)
      const original = service.getPublic()
      for (let i = 0; i < 1000; i++) expect(service.getPublic()).toEqual(original)
      expect(pool.query).toHaveBeenCalledTimes(2)
      expect(pool.execute).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(MODEL_SYNC_INTERVAL_MS - 1)
      expect(source).toHaveBeenCalledTimes(1)
      expect(service.getPublic()?.stale).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(source).toHaveBeenCalledTimes(2)
    } finally { await service.close() }
    await vi.advanceTimersByTimeAsync(MODEL_SYNC_INTERVAL_MS)
    expect(source).toHaveBeenCalledTimes(2)
  })

  it('restores saved prices after restart and waits out the remaining hourly interval', async () => {
    vi.useFakeTimers()
    const pool = memoryPool(), source = vi.fn(async () => fixture())
    const first = new ModelCatalogService(pool as unknown as Pool, source)
    await first.initialize(); await first.sync(); await first.close()
    const original = first.getPublic()
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    const restarted = new ModelCatalogService(pool as unknown as Pool, source)
    await restarted.start(); await restarted.start()
    try {
      expect(restarted.getPublic()).toEqual(original)
      await vi.advanceTimersByTimeAsync(40 * 60_000 - 1)
      expect(source).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(source).toHaveBeenCalledTimes(2)
    } finally { await restarted.close() }
  })

  it('keeps failed-read retries hourly, including after a restart', async () => {
    vi.useFakeTimers()
    const pool = memoryPool(), source = vi.fn(async () => fixture())
    const first = new ModelCatalogService(pool as unknown as Pool, source)
    await first.initialize(); await first.sync()
    await vi.advanceTimersByTimeAsync(MODEL_SYNC_INTERVAL_MS)
    source.mockRejectedValueOnce(new Error('Unavailable'))
    await first.sync(); await first.close()
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    const restarted = new ModelCatalogService(pool as unknown as Pool, source)
    await restarted.start()
    try {
      expect(restarted.getPublic()?.stale).toBe(true)
      await vi.advanceTimersByTimeAsync(40 * 60_000 - 1)
      expect(source).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(source).toHaveBeenCalledTimes(3)
      expect(restarted.getPublic()?.stale).toBe(false)
    } finally { await restarted.close() }
  })

  it('moves the scheduled read after an explicit administrator sync', async () => {
    vi.useFakeTimers()
    const source = vi.fn(async () => fixture())
    const service = new ModelCatalogService(memoryPool() as unknown as Pool, source)
    await service.start()
    try {
      await vi.advanceTimersByTimeAsync(20 * 60_000)
      expect(source).toHaveBeenCalledTimes(1)
      await service.sync()
      expect(source).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(40 * 60_000)
      expect(source).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(20 * 60_000)
      expect(source).toHaveBeenCalledTimes(3)
    } finally { await service.close() }
  })

  it('honors disabled syncing and uses an expiry appropriate to hourly snapshots', async () => {
    vi.useFakeTimers(); vi.stubEnv('MODEL_SYNC_ENABLED', 'false')
    const source = vi.fn(async () => fixture())
    const service = new ModelCatalogService(memoryPool() as unknown as Pool, source)
    await service.initialize(); await service.sync(); await service.start()
    await vi.advanceTimersByTimeAsync(MODEL_SYNC_INTERVAL_MS)
    expect(service.getPublic()?.stale).toBe(false)
    await vi.advanceTimersByTimeAsync(MODEL_SNAPSHOT_STALE_MS - MODEL_SYNC_INTERVAL_MS + 1)
    expect(service.getPublic()?.stale).toBe(true)
    expect(source).toHaveBeenCalledTimes(1)
    await service.close()
  })

  it('coalesces syncs and preserves the last success after failure and restart', async () => {
    const pool = memoryPool(), source = vi.fn(async () => fixture()), service = new ModelCatalogService(pool as unknown as Pool, source)
    await service.initialize(); expect(service.getPublic()).toBeNull()
    const first = service.sync(), concurrent = service.sync(); expect(first).toBe(concurrent)
    expect(await first).toBe(true); expect(source).toHaveBeenCalledTimes(1)
    const original = service.getPublic()!
    await vi.advanceTimersByTimeAsync(MODEL_SYNC_COOLDOWN_MS)
    source.mockRejectedValueOnce(new Error('postgres://password-sensitive-connection'))
    expect(await service.sync()).toBe(false)
    expect(service.getPublic()).toMatchObject({ updatedAt: original.updatedAt, stale: true })
    expect(JSON.stringify(service.getAdmin())).not.toContain('password-sensitive')
    const restarted = new ModelCatalogService(pool as unknown as Pool, source); await restarted.initialize()
    expect(restarted.getPublic()).toMatchObject({ updatedAt: original.updatedAt, stale: true })
  })
  it('persists explicit visibility and leaves newly discovered groups hidden', async () => {
    const pool = memoryPool(), source = fixture(), service = new ModelCatalogService(pool as unknown as Pool, async () => source)
    await service.initialize(); await service.sync()
    const settings = service.getAdmin().settings; settings.groups.find(g => g.id === '12')!.visible = false
    await service.saveSettings(settings)
    expect(service.getPublic()!.groups.some(g => g.id === '12')).toBe(false)
    source.groups.push({ ...source.groups[0], id: '999', name: '新订阅' })
    source.mappings.push({ ...source.mappings[0], group_id: '999' })
    await vi.advanceTimersByTimeAsync(MODEL_SYNC_COOLDOWN_MS)
    await service.sync()
    expect(service.getAdmin().settings.groups.find(g => g.id === '999')?.visible).toBe(false)
    expect(service.getPublic()!.groups.some(g => g.id === '999')).toBe(false)
  })
  it('publishes an authoritative empty source instead of retaining withdrawn models', async () => {
    const pool = memoryPool(), source = vi.fn(async () => fixture()), service = new ModelCatalogService(pool as unknown as Pool, source)
    await service.initialize(); await service.sync()
    await vi.advanceTimersByTimeAsync(MODEL_SYNC_COOLDOWN_MS)
    source.mockResolvedValueOnce({ ...fixture(), mappings: [] })
    expect(await service.sync()).toBe(true)
    expect(service.getPublic()!.groups).toEqual([])
  })
  it('removes withdrawn account mappings while retaining the same model in another active group', async () => {
    const value = fixture(), source = vi.fn(async () => value), service = new ModelCatalogService(memoryPool() as unknown as Pool, source)
    await service.initialize(); await service.sync()
    const name = 'gpt-example'
    value.mappings = value.mappings.map(m => ({ ...m, mapping: { ...m.mapping } }))
    for (const m of value.mappings.filter(m => m.group_id !== '26')) delete m.mapping[name]
    await vi.advanceTimersByTimeAsync(MODEL_SYNC_COOLDOWN_MS)
    await service.sync()
    const catalog = service.getPublic()!
    expect(catalog.groups.filter(g => g.models.some(m => m.id === name)).map(g => g.id)).toEqual(['26'])
    for (const m of value.mappings) delete m.mapping[name]
    await vi.advanceTimersByTimeAsync(MODEL_SYNC_COOLDOWN_MS)
    await service.sync()
    expect(service.getPublic()!.groups.every(g => g.models.every(m => m.id !== name))).toBe(true)
    expect(service.getPublic()!.platforms.find(p => p.id === 'openai')?.count).toBe(1)
  })
  it('invalidates cached prices after settings changes and prevents concurrent saves', async () => {
    const pool = memoryPool(), service = new ModelCatalogService(pool as unknown as Pool, async () => fixture())
    await service.initialize(); await service.sync()
    expect(service.getPublic()!.groups[0].models[0].items[0].final).toBe('0.8')
    const settings = service.getAdmin().settings; settings.exchange.openaiSubscription = '0.04'
    let finish!: () => void
    const originalExecute = pool.execute.getMockImplementation()!
    pool.execute.mockImplementationOnce(async (sql, values) => { await new Promise<void>(resolve => { finish = resolve }); return originalExecute(sql, values) })
    const saving = service.saveSettings(settings)
    await expect(service.saveSettings(settings)).rejects.toMatchObject({ statusCode: 409 })
    expect(await service.sync()).toBe(false)
    finish(); await saving
    expect(service.getPublic()!.groups[0].models[0].items[0].final).toBe('1.6')
  })
})
