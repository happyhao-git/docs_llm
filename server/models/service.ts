import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { buildSnapshot, defaultSettings, initialSettings, publicCatalog } from './catalog.js'
import { readModelSource, type ModelSource } from './source.js'
import { MODEL_SYNC_INTERVAL_MINUTES, MODEL_SYNC_INTERVAL_MS, MODEL_SNAPSHOT_STALE_MS, MODEL_SYNC_COOLDOWN_MS } from './policy.js'
import type { CatalogSnapshot, PlazaAdmin, PlazaSettings, PublicCatalog } from './types.js'

export class ModelCatalogService {
  private snapshot: CatalogSnapshot | null = null
  private settings: PlazaSettings = defaultSettings()
  private initialized = false
  private settingsSaved = false
  private pending: Promise<boolean> | null = null
  private timer?: ReturnType<typeof setTimeout>
  private started = false
  private lastAttemptAt: string | null = null
  private error: string | null = null
  private publicCache: PublicCatalog | null = null
  private saving = false
  constructor(private pool: Pool, private source: () => Promise<ModelSource> = readModelSource) {}
  async initialize() {
    if (this.initialized) return
    await this.restore(this.pool)
    this.initialized = true
  }
  private async restore(connection: Pool | PoolConnection) {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT settings_json,snapshot_json,last_attempt_at,last_error FROM model_plaza_state WHERE id=1')
    const row = rows[0]
    if (row?.settings_json) { this.settings = JSON.parse(row.settings_json); this.settingsSaved = true }
    if (row?.snapshot_json) this.snapshot = JSON.parse(row.snapshot_json)
    this.lastAttemptAt = row?.last_attempt_at ? new Date(row.last_attempt_at).toISOString() : null
    this.error = row?.last_error || null
    this.publicCache = null
  }
  async start() {
    await this.initialize()
    if (process.env.MODEL_SYNC_ENABLED === 'false' || this.started) return
    this.started = true
    this.scheduleNext()
  }
  private scheduleNext(minimumDelay = 0) {
    if (!this.started) return
    clearTimeout(this.timer)
    // Keep the saved attempt time across restarts, even after a failed read.
    // Restarts and ordinary visits must not create another upstream read.
    const last = Date.parse(this.lastAttemptAt || this.snapshot?.updatedAt || '')
    const delay = Number.isFinite(last) ? Math.max(0, MODEL_SYNC_INTERVAL_MS - Math.max(0, Date.now() - last)) : 0
    this.timer = setTimeout(() => { this.timer = undefined; void this.sync() }, Math.max(minimumDelay, delay))
    this.timer.unref()
  }
  async close() { this.started = false; clearTimeout(this.timer); this.timer = undefined; await this.pending }
  getPublic() {
    if (!this.snapshot) return null
    this.publicCache ||= publicCatalog(this.snapshot, this.settings)
    return { ...this.publicCache, stale: !!this.error || Date.now() - Date.parse(this.snapshot.updatedAt) > MODEL_SNAPSHOT_STALE_MS }
  }
  getAdmin(): PlazaAdmin {
    return { settings: structuredClone(this.settings), inventory: this.snapshot?.inventory || [], status: { syncing: !!this.pending, syncIntervalMinutes: MODEL_SYNC_INTERVAL_MINUTES, lastAttemptAt: this.lastAttemptAt, lastSuccessAt: this.snapshot?.updatedAt || null, error: this.error, warnings: this.snapshot?.warnings || [] } }
  }
  retryAfterSeconds() {
    const last = Date.parse(this.lastAttemptAt || '')
    return Number.isFinite(last) ? Math.max(0, Math.ceil((last + MODEL_SYNC_COOLDOWN_MS - Date.now()) / 1000)) : 0
  }
  async saveSettings(settings: PlazaSettings) {
    if (this.pending || this.saving) throw Object.assign(new Error('目录更新中，请稍后保存'), { statusCode: 409 })
    const ids = new Set(this.snapshot?.inventory.map(g => g.id) || [])
    if (settings.groups.some(g => !ids.has(g.id)) || new Set(settings.groups.map(g => g.id)).size !== settings.groups.length) throw Object.assign(new Error('分组列表已变化，请刷新后重试'), { statusCode: 409 })
    this.saving = true
    try {
      await this.pool.execute(`INSERT INTO model_plaza_state(id,settings_json) VALUES(1,?) ON DUPLICATE KEY UPDATE settings_json=VALUES(settings_json)`, [JSON.stringify(settings)])
      this.settings = settings; this.settingsSaved = true; this.publicCache = null
    } finally { this.saving = false }
  }
  sync(): Promise<boolean> {
    if (this.pending) return this.pending
    if (this.saving) { this.scheduleNext(1000); return Promise.resolve(false) }
    this.pending = this.performSync().finally(() => { this.pending = null; this.scheduleNext(this.error ? MODEL_SYNC_COOLDOWN_MS : 1000) })
    return this.pending
  }
  private async performSync() {
    let connection: PoolConnection | undefined, locked = false, attempted = false
    try {
      connection = await this.pool.getConnection()
      const [locks] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(CONCAT(DATABASE(), ':model-catalog-sync'), 0) AS acquired")
      locked = Number(locks[0]?.acquired) === 1
      // All workers use the same database lock and persisted attempt time.
      // A follower serves the latest saved snapshot without reading upstream.
      await this.restore(connection)
      if (!locked || this.retryAfterSeconds() > 0) return false
      // The existing DATETIME column has whole-second precision. Round upward
      // so persisting/restarting cannot shorten the global 60-second window.
      this.lastAttemptAt = new Date(Math.ceil(Date.now() / 1000) * 1000).toISOString()
      await connection.execute(`INSERT INTO model_plaza_state(id,last_attempt_at) VALUES(1,?)
        ON DUPLICATE KEY UPDATE last_attempt_at=VALUES(last_attempt_at)`, [new Date(this.lastAttemptAt)])
      attempted = true
      const source = await this.source()
      const settings = this.settingsSaved ? structuredClone(this.settings) : initialSettings(source)
      const activeIds = new Set(source.groups.map(g => String(g.id)))
      settings.groups = settings.groups.filter(g => activeIds.has(g.id))
      const known = new Set(settings.groups.map(g => g.id))
      for (const g of source.groups) if (!known.has(String(g.id))) settings.groups.push({ id: String(g.id), visible: false, name: '', order: settings.groups.length, isDefault: false })
      const snapshot = buildSnapshot(source, settings)
      // A successful empty source is authoritative (e.g. all groups disabled).
      // Failed reads/validation throw before this point and preserve the last snapshot.
      await connection.execute(`INSERT INTO model_plaza_state(id,settings_json,snapshot_json,last_attempt_at,last_error) VALUES(1,?,?,?,NULL)
        ON DUPLICATE KEY UPDATE settings_json=VALUES(settings_json),snapshot_json=VALUES(snapshot_json),last_attempt_at=VALUES(last_attempt_at),last_error=NULL`,
        [JSON.stringify(settings), JSON.stringify(snapshot), new Date(this.lastAttemptAt)])
      this.settings = settings; this.settingsSaved = true; this.snapshot = snapshot; this.error = null; this.publicCache = null
      return true
    } catch {
      this.error = '同步失败：请检查数据源连接及价格文件。'
      if (attempted && connection && this.lastAttemptAt) await connection.execute(`INSERT INTO model_plaza_state(id,last_attempt_at,last_error) VALUES(1,?,?)
        ON DUPLICATE KEY UPDATE last_attempt_at=VALUES(last_attempt_at),last_error=VALUES(last_error)`, [new Date(this.lastAttemptAt), this.error]).catch(() => undefined)
      return false
    } finally {
      if (connection) {
        try {
          if (locked) await connection.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':model-catalog-sync'))")
          connection.release()
        } catch { connection.destroy() }
      }
    }
  }
}
