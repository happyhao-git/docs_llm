import { describe, expect, it } from 'vitest'
import { modelRelease, validReleaseDate } from './releases.js'

describe('verified release metadata', () => {
  it('uses official launch dates rather than snapshot suffixes or deprecation dates', () => {
    expect(modelRelease('claude-opus-4-5-20251101').releasedAt).toBe('2025-11-24')
    expect(modelRelease('claude-haiku-4-5-20251001').releasedAt).toBe('2025-10-15')
    expect(modelRelease('unknown-20251101', { deprecation_date: '2025-11-01' }).releasedAt).toBeNull()
    expect(modelRelease('claude-opus-5-5').releasedAt).toBeNull()
  })
  it('supports explicit source release dates and rejects invalid or future dates', () => {
    expect(modelRelease('new-model', { release_date: '2026-11-01', release_source: 'https://example.com/news/model' })).toEqual({ releasedAt: '2026-11-01', releaseSource: 'https://example.com/news/model' })
    for (const value of ['2025-02-30', '2025-13-01', 'not-a-date', '2025-1-1', '']) expect(validReleaseDate(value)).toBe(false)
    expect(modelRelease('new-model', { release_date: '2028-01-01' }).releasedAt).toBeNull()
    expect(modelRelease('new-model', { release_date: '2026-01-01', release_source: 'javascript:alert(1)' }).releaseSource).toBeNull()
  })
})
