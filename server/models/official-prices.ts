import type { SourceRecord } from './source.js'

// Verified against the official model page on 2026-11-04. This local fallback
// covers an exact missing model only; a synchronized card always takes priority.
// https://docs.x.ai/developers/models/grok-4.7
const verifiedCards: Record<string, SourceRecord> = {
  'grok-4.7': {
    mode: 'chat',
    litellm_provider: 'xai',
    input_cost_per_token: '0.000002',
    output_cost_per_token: '0.000006',
    cache_read_input_token_cost: '0.0000005',
    input_cost_per_token_above_200k_tokens: '0.000004',
    output_cost_per_token_above_200k_tokens: '0.000012',
    cache_read_input_token_cost_above_200k_tokens: '0.000001',
    source: 'https://docs.x.ai/developers/models/grok-4.7'
  }
}

export function officialPriceCard(name: string, synchronized: Record<string, SourceRecord>): SourceRecord {
  return synchronized[name] ?? verifiedCards[name] ?? {}
}
