import type { DocumentDetail, NavigationSite } from '../types'

export interface DocumentResponse {
  publication: NavigationSite['publication']
  document?: DocumentDetail
}

// Only published articles enter this bounded, in-memory cache. Changing the
// publication invalidates both cached entries and results of older requests.
export class DocumentCache {
  private publicationId: number | null | undefined
  private entries = new Map<string, DocumentResponse>()
  private pending = new Map<string, Promise<DocumentResponse>>()
  private controllers = new Set<AbortController>()

  constructor(private fetcher: typeof fetch = (input, init) => fetch(input, init), private capacity = 20) {}

  setPublication(id: number | null) {
    if (id === this.publicationId) return
    this.publicationId = id
    for (const [slug, entry] of this.entries) {
      if (entry.publication?.id !== id) this.entries.delete(slug)
    }
  }

  peek(slug: string) {
    const entry = this.entries.get(slug)
    if (entry) { this.entries.delete(slug); this.entries.set(slug, entry) }
    return entry
  }

  load(slug: string): Promise<DocumentResponse> {
    const cached = this.peek(slug)
    if (cached) return Promise.resolve(cached)
    const key = `${this.publicationId ?? 'initial'}:${slug}`
    const pending = this.pending.get(key)
    if (pending) return pending
    const controller = new AbortController()
    this.controllers.add(controller)
    const timer = setTimeout(() => controller.abort(), 15_000)
    const request = this.fetcher(`/api/public/documents/${encodeURIComponent(slug)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok && response.status !== 404) throw new Error('这篇教程暂时无法加载，请重试。')
        const payload: DocumentResponse = await response.json()
        if (payload.document && !controller.signal.aborted && (this.publicationId === undefined || payload.publication?.id === this.publicationId)) {
          this.entries.set(slug, payload)
          while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!)
        }
        return payload
      }).finally(() => {
        clearTimeout(timer)
        this.controllers.delete(controller)
        this.pending.delete(key)
      })
    this.pending.set(key, request)
    return request
  }

  dispose() {
    this.controllers.forEach(controller => controller.abort())
    this.entries.clear()
  }
}
