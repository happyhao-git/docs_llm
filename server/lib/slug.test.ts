import { describe, expect, it } from 'vitest'
import { slugify } from './slug.js'

describe('slugify', () => {
  it('keeps Chinese text and normalizes spacing', () => {
    expect(slugify('  快速 开始  ')).toBe('快速-开始')
  })

  it('uses a fallback for punctuation-only labels', () => {
    expect(slugify('***', 'document')).toBe('document')
  })
})
