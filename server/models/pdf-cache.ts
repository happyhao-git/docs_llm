import { createHash } from 'node:crypto'
import type { PriceExportRequest } from './export-contract.js'
import type { PriceExportData } from './pdf-data.js'

export const PDF_CACHE_TTL = 10 * 60_000
const MAX_BYTES = 8 * 1024 * 1024, MAX_ENTRIES = 32
export interface CachedPricePdf { bytes: Buffer; generatedAt: string; expiresAt: number }

export function pricePdfKey(request: PriceExportRequest, origin: string): string {
  return createHash('sha256').update(JSON.stringify({ template: 2, origin: new URL(origin).origin,
    catalogHash: request.catalogHash, billing: request.billing, rows: request.rows,
    showRelease: request.showRelease, showPlatform: !!request.showPlatform })).digest('hex')
}

// Bounded cache of public exports, shared across visitors. The route validates the
// current catalog before every lookup, so changes to prices/visibility take effect immediately.
export class PricePdfCache {
  private entries = new Map<string, CachedPricePdf>()
  private pending = new Map<string, Promise<CachedPricePdf>>()
  private bytes = 0
  private closed = false
  constructor(private renderer: { generate(data: PriceExportData): Promise<Buffer> }, private now = Date.now) {}

  get(key: string): CachedPricePdf | undefined {
    for (const [id, entry] of this.entries) if (entry.expiresAt <= this.now()) this.remove(id)
    const entry = this.entries.get(key)
    if (entry) { this.entries.delete(key); this.entries.set(key, entry) }
    return entry
  }

  async generate(key: string, data: PriceExportData): Promise<{ pdf: CachedPricePdf; state: 'hit' | 'shared' | 'miss' }> {
    const cached = this.get(key)
    if (cached) return { pdf: cached, state: 'hit' }
    const shared = this.pending.get(key)
    if (shared) return { pdf: await shared, state: 'shared' }
    const job = Promise.resolve().then(() => this.renderer.generate(data)).then(bytes => {
      const pdf = { bytes, generatedAt: data.generatedAt, expiresAt: this.now() + PDF_CACHE_TTL }
      if (!this.closed && bytes.length <= MAX_BYTES) {
        this.entries.set(key, pdf); this.bytes += bytes.length
        while (this.entries.size > MAX_ENTRIES || this.bytes > MAX_BYTES) this.remove(this.entries.keys().next().value!)
      }
      return pdf
    }).finally(() => this.pending.delete(key))
    this.pending.set(key, job)
    return { pdf: await job, state: 'miss' }
  }

  private remove(key: string) {
    const entry = this.entries.get(key)
    if (entry) { this.bytes -= entry.bytes.length; this.entries.delete(key) }
  }
  close() { this.closed = true; this.entries.clear(); this.bytes = 0 }
}
