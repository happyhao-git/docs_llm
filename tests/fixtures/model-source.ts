import type { ModelSource } from '../../server/models/source.js'

export function modelSourceFixture(): ModelSource {
  const common = { status: 'active', is_exclusive: false, model_allowlist: { enabled: false, models: ['ignored'] }, model_pricing: [], allow_image_generation: true, long_context_pricing_enabled: true }
  return {
    groups: [
      { ...common, id: '12', name: 'openai-100刀/天', platform: 'openai', subscription_type: 'subscription', rate_multiplier: '4' },
      { ...common, id: '67', name: '一卡通-100刀/天', platform: 'composite', subscription_type: 'subscription', rate_multiplier: '2.667', platform_rate_multipliers: { anthropic: 4 } },
      { ...common, id: '78', name: '一卡通-200刀/天', platform: 'composite', subscription_type: 'subscription', rate_multiplier: '2.667', platform_rate_multipliers: { anthropic: 4, openai: 2.667 } },
      { ...common, id: '26', name: 'ChatGPT-Plus【稳定】', platform: 'openai', subscription_type: 'standard', rate_multiplier: '1' },
      { ...common, id: '61', name: 'test', platform: 'openai', subscription_type: 'standard', rate_multiplier: '1', is_exclusive: true }
    ],
    mappings: ['12','67','78','26','61'].map(group_id => ({ group_id, platform: 'openai', mapping: { 'gpt-example': 'gpt-example', 'unknown-model': 'unknown-model', '__monitor_no_available_model__': '__monitor_no_available_model__' } })),
    official: { 'gpt-example': { input_cost_per_token: 0.00001, output_cost_per_token: 0.00003, cache_read_input_token_cost: 0.000001, input_cost_per_token_above_272k_tokens: 0.00002 } },
    channels: [], prices: [], intervals: [], routes: [], pricingUpdatedAt: '2026-11-04T00:00:00.000Z'
  }
}
