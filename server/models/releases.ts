import type { SourceRecord } from './source.js'

// Exact IDs only. Dates verified from official announcement datePublished
// metadata on 2026-11-05. Snapshot suffixes are not release dates.
const releases: Array<[string[], string, string]> = [
  [['claude-opus-5'], '2026-07-24', 'claude-opus-5'],
  [['claude-sonnet-5'], '2026-06-30', 'claude-sonnet-5'],
  [['claude-opus-4-8'], '2026-05-28', 'claude-opus-4-8'],
  [['claude-opus-4-7'], '2026-04-16', 'claude-opus-4-7'],
  [['claude-sonnet-4-6'], '2026-02-17', 'claude-sonnet-4-6'],
  [['claude-opus-4-6'], '2026-02-05', 'claude-opus-4-6'],
  [['claude-sonnet-4-5', 'claude-sonnet-4-5-20250929'], '2025-09-29', 'claude-sonnet-4-5'],
  [['claude-haiku-4-5-20251001'], '2025-10-15', 'claude-haiku-4-5'],
  [['claude-opus-4-5-20251101'], '2025-11-24', 'claude-opus-4-5'],
  [['claude-opus-4-20250514', 'claude-sonnet-4-20250514'], '2025-05-22', 'claude-4'],
  [['claude-opus-4-1-20250805'], '2025-08-05', 'claude-opus-4-1'],
  [['claude-3-7-sonnet-20250219'], '2025-02-24', 'claude-3-7-sonnet'],
  [['claude-3-5-sonnet-20241022'], '2024-10-22', '3-5-models-and-computer-use'],
  [['claude-3-5-sonnet-20240620'], '2024-06-21', 'claude-3-5-sonnet']
]
export function validReleaseDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}
export function modelRelease(id: string, card: SourceRecord = {}, now = new Date()) {
  const verified = releases.find(([ids]) => ids.includes(id))
  const provided = card.release_date
  if (validReleaseDate(provided) && provided <= now.toISOString().slice(0, 10)) {
    let source: string | null = null
    try { const url = new URL(card.release_source || card.source); if (url.protocol === 'https:' && !url.username && !url.password && !url.search) source = url.toString() } catch { /* An optional source. */ }
    return { releasedAt: provided, releaseSource: source }
  }
  return verified && verified[1] <= now.toISOString().slice(0, 10)
    ? { releasedAt: verified[1], releaseSource: `https://www.anthropic.com/news/${verified[2]}` }
    : { releasedAt: null, releaseSource: null }
}
