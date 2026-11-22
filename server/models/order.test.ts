import { describe, expect, it } from 'vitest'
import { compareModelOrder } from './order.js'
import type { ModelKind } from './types.js'

const sort = (ids: string[], platform = 'openai', kind: ModelKind = 'text') => ids
  .map(id => ({ id, platform, kind })).sort(compareModelOrder).map(m => m.id)

describe('model listing order', () => {
  it('shows newer OpenAI versions first and review models last', () => {
    expect(sort(['codex-auto-review', 'gpt-5.5', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6.1-terra', 'gpt-5.6-sol']))
      .toEqual(['gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6-sol', 'gpt-5.5', 'codex-auto-review'])
  })
  it('compares multi-digit versions numerically and does not demote previews as reviews', () => {
    expect(sort(['gpt-6.9', 'gpt-6.10', 'gpt-6.11-preview', 'gpt-8-review']))
      .toEqual(['gpt-6.11-preview', 'gpt-6.10', 'gpt-6.9', 'gpt-8-review'])
  })
  it('handles Claude hyphenated versions and dated snapshots', () => {
    expect(sort(['claude-opus-4-5-20251101', 'claude-opus-5-5', 'claude-opus-4-8', 'claude-opus-4-5', 'claude-opus-5'], 'anthropic'))
      .toEqual(['claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-5', 'claude-opus-4-5-20251101'])
  })
  it('applies newer-version ordering to the other platforms', () => {
    expect(sort(['grok-4.5', 'grok-4.7', 'grok-4.6'], 'grok')).toEqual(['grok-4.7', 'grok-4.6', 'grok-4.5'])
    expect(sort(['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4.1-flash'], 'deepseek')).toEqual(['deepseek-v4.1-flash', 'deepseek-v4-pro', 'deepseek-v4-flash'])
    expect(sort(['glm-5.2', 'glm-5.3'], 'zhipu')).toEqual(['glm-5.3', 'glm-5.2'])
  })
  it('keeps the GPT Image family ahead of legacy DALL-E versions', () => {
    expect(sort(['dall-e-3', 'gpt-image-1', 'codex-gpt-image-2', 'gpt-image-2.5', 'gpt-image-2', 'dall-e-2'], 'openai', 'image'))
      .toEqual(['gpt-image-2.5', 'gpt-image-2', 'codex-gpt-image-2', 'gpt-image-1', 'dall-e-3', 'dall-e-2'])
  })
})
