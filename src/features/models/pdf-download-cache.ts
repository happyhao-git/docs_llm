export interface DownloadedPricePdf { blob: Blob; filename: string }
export interface SavedPricePdf extends DownloadedPricePdf { serverKey: string; expiresAt: number }
const TTL = 10 * 60_000, MAX_ENTRIES = 8, MAX_BYTES = 4 * 1024 * 1024

// Session-only blobs: no large files in localStorage, and no download without
// validating the current price version with the server first.
export class PdfDownloadCache {
  private entries = new Map<string, SavedPricePdf>()
  private bytes = 0
  constructor(private now = Date.now) {}
  get(key: string) {
    for (const [id, entry] of this.entries) if (entry.expiresAt <= this.now()) this.remove(id)
    const entry = this.entries.get(key)
    if (entry) { this.entries.delete(key); this.entries.set(key, entry) }
    return entry
  }
  save(key: string, value: DownloadedPricePdf, serverKey: string) {
    if (value.blob.size > MAX_BYTES) return
    this.remove(key)
    this.entries.set(key, { ...value, serverKey, expiresAt: this.now() + TTL }); this.bytes += value.blob.size
    while (this.entries.size > MAX_ENTRIES || this.bytes > MAX_BYTES) this.remove(this.entries.keys().next().value!)
  }
  remove(key: string) {
    const entry = this.entries.get(key)
    if (entry) { this.bytes -= entry.blob.size; this.entries.delete(key) }
  }
}
