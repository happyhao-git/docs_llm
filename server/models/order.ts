import type { CatalogModel } from './types.js'

type ModelIdentity = Pick<CatalogModel, 'id' | 'platform' | 'kind'>
const reviewModel = (id: string) => /(?:^|[-_.])review(?:$|[-_.])/i.test(id)
const kinds = ['text', 'image', 'video', 'audio', 'embedding', 'other']

function version(id: string): number[] {
  // Claude uses both dotted and hyphenated versions; a dated snapshot is
  // not an extra version component (e.g. opus-4-5-20251101).
  const value = id.startsWith('claude-')
    ? id.match(/\d+(?:[.-]\d+)*/)?.[0]
    : id.match(/\d+(?:\.\d+)*/)?.[0]
  return value?.split(/[.-]/).map(Number).filter(n => n < 1000000) || []
}

function snapshotDate(id: string): number {
  const date = id.match(/(?:^|[-_])((?:19|20)\d{2})[-_]?(\d{2})[-_]?(\d{2})(?:$|[-_])/)
  return date ? Number(date[1] + date[2] + date[3]) : 0
}

function imageFamily(model: ModelIdentity): number {
  if (model.platform !== 'openai' || model.kind !== 'image') return 0
  // GPT Image and DALL-E have separate version sequences.
  if (/(?:^|-)gpt-image-/.test(model.id)) return 0
  if (model.id.startsWith('dall-e-')) return 1
  return 2
}

export function compareModelOrder(a: ModelIdentity, b: ModelIdentity): number {
  const review = Number(reviewModel(a.id)) - Number(reviewModel(b.id))
  if (review) return review
  const platform = a.platform.localeCompare(b.platform)
  if (platform) return platform
  const kind = kinds.indexOf(a.kind) - kinds.indexOf(b.kind)
  if (kind) return kind
  const family = imageFamily(a) - imageFamily(b)
  if (family) return family
  const left = version(a.id), right = version(b.id)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (right[i] || 0) - (left[i] || 0)
    if (difference) return difference
  }
  const leftDate = snapshotDate(a.id), rightDate = snapshotDate(b.id)
  if (!!leftDate !== !!rightDate) return leftDate ? 1 : -1
  if (leftDate !== rightDate) return rightDate - leftDate
  // Prefer the canonical callable ID over a compatibility alias.
  const alias = Number(a.id.startsWith('codex-gpt-image-')) - Number(b.id.startsWith('codex-gpt-image-'))
  if (alias) return alias
  // A deterministic variant order puts 6.1-terra before 6.1-sol.
  return left.length || right.length
    ? b.id.localeCompare(a.id, 'en', { numeric: true })
    : a.id.localeCompare(b.id, 'en', { numeric: true })
}
