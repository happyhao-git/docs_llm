import { exportCatalogContent, type ExportSelection } from '../../../server/models/export-contract'
import type { BillingMode, PublicCatalog } from './types'
import { PdfDownloadCache, type DownloadedPricePdf } from './pdf-download-cache'

export class CatalogChangedError extends Error {}
const downloads = new PdfDownloadCache()
const hashes = new WeakMap<PublicCatalog, { content: string; hash: Promise<string> }>()
function catalogHash(catalog: PublicCatalog): Promise<string> {
  const content = exportCatalogContent(catalog), cached = hashes.get(catalog)
  if (cached?.content === content) return cached.hash
  const hash = crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
    .then(digest => Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''))
  hashes.set(catalog, { content, hash })
  return hash
}

export async function fetchPricePdf(catalog: PublicCatalog, billing: BillingMode, rows: ExportSelection[], showRelease: boolean,
  signal?: AbortSignal, showPlatform = false): Promise<DownloadedPricePdf> {
  const request = { billing, catalogHash: await catalogHash(catalog), rows, showRelease, showPlatform }
  const key = JSON.stringify(request), cached = downloads.get(key)
  const response = await fetch('/api/public/models/export.pdf', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...request, ...(cached ? { cachedPdf: cached.serverKey } : {}) }) })
  if (response.status === 409) { downloads.remove(key); throw new CatalogChangedError('价格表已更新，请重新导出。') }
  if (!response.ok) throw new Error(response.status === 429 ? '导出较频繁，请稍后重试。' : '暂时无法导出，请稍后重试。')
  if (response.status === 204) {
    if (cached && response.headers.get('x-price-pdf-key') === cached.serverKey) return cached
    throw new Error('导出失败，请重试。')
  }
  if (!response.headers.get('content-type')?.startsWith('application/pdf')) throw new Error('导出失败，请重试。')
  const encoded = response.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  let filename = `AiLink-价格表-${billing === 'subscription' ? '订阅' : '余额'}.pdf`
  if (encoded) try { filename = decodeURIComponent(encoded) } catch { /* Keep a usable fallback name. */ }
  const result = { blob: await response.blob(), filename }, serverKey = response.headers.get('x-price-pdf-key')
  if (serverKey && /^[a-f0-9]{64}$/.test(serverKey)) downloads.save(key, result, serverKey)
  return result
}
