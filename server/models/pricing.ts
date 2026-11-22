import { Decimal } from 'decimal.js'
import type { SourceRecord } from './source.js'
import type { ModelKind, PriceItem } from './types.js'

export function decimal(value: unknown): string | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  try { const n = new Decimal(String(value)); return n.isFinite() && n.gte(0) ? n.toString() : null } catch { return null }
}
export const multiply = (...values: Array<string | number>) => values.reduce<Decimal>((n, v) => n.mul(v), new Decimal(1)).toString()
export function rateFor(group: SourceRecord, platform: string, kind: ModelKind) {
  if (kind === 'image' && group.image_rate_independent) return decimal(group.image_rate_multiplier)
  if (kind === 'video' && group.video_rate_independent) return decimal(group.video_rate_multiplier)
  return decimal(group.platform_rate_multipliers?.[platform] ?? group.rate_multiplier)
}
export function identifyKind(name: string, official: SourceRecord = {}): ModelKind {
  const mode = String(official.mode || '')
  if (/image|dall-e|imagine$/.test(name) || mode.includes('image')) return 'image'
  if (/video|sora/.test(name) || mode.includes('video')) return 'video'
  if (/audio|realtime|tts|whisper/.test(name) || /audio|realtime/.test(mode)) return 'audio'
  if (/embedding|rerank/.test(mode) || /embed|rerank/.test(name)) return 'embedding'
  return 'text'
}
export const priceFields = [
  ['input', '输入', 'input_cost_per_token', 'input_price', 1000000, '百万 tokens'],
  ['output', '输出', 'output_cost_per_token', 'output_price', 1000000, '百万 tokens'],
  ['cacheRead', '缓存命中', 'cache_read_input_token_cost', 'cache_read_price', 1000000, '百万 tokens'],
  ['cacheWrite', '缓存写入', 'cache_creation_input_token_cost', 'cache_write_price', 1000000, '百万 tokens'],
  ['cacheWrite1h', '缓存写入 · 1 小时', 'cache_creation_input_token_cost_above_1hr', 'cache_write_1h_price', 1000000, '百万 tokens'],
  ['imageInput', '图片输入', 'input_cost_per_image_token', 'image_input_price', 1000000, '百万图片 tokens'],
  ['imageOutput', '图片输出', 'output_cost_per_image_token', 'image_output_price', 1000000, '百万图片 tokens'],
  ['imageCache', '图片缓存命中', 'cache_read_input_image_token_cost', '', 1000000, '百万图片 tokens'],
  ['audioInput', '音频输入', 'input_cost_per_audio_token', '', 1000000, '百万音频 tokens'],
  ['audioOutput', '音频输出', 'output_cost_per_audio_token', '', 1000000, '百万音频 tokens'],
  ['perImage', '生成图片', 'output_cost_per_image', '', 1, '张'],
  ['perSecond', '生成视频', 'output_cost_per_second', '', 1, '秒'],
  ['audioSecond', '音频处理', 'input_cost_per_second', '', 60, '分钟'],
  ['characters', '语音合成', 'output_cost_per_character', '', 1000000, '百万字符']
] as const

export function calculateItems(official: SourceRecord, effective: SourceRecord, override: SourceRecord | undefined, rate: string, exchange: string, condition?: string): PriceItem[] {
  const coefficient = multiply(rate, exchange)
  const item = (key: string, label: string, unit: string, reference: unknown, base: unknown, factor = 1): PriceItem => {
    const o = decimal(reference), b = decimal(base)
    return { key, label, unit, official: o === null ? null : multiply(o, factor),
      base: b === null ? null : multiply(b, factor), final: b === null ? null : multiply(b, factor, coefficient),
      rate, coefficient, ...(condition ? { condition } : {}) }
  }
  if (override?.billing_mode && !['token', 'tokens'].includes(override.billing_mode)) {
    if (['per_request', 'request', 'per_image', 'image'].includes(override.billing_mode)) {
      const image = override.billing_mode.includes('image')
      return [item('perRequest', image ? '生成图片' : '调用', image ? '张' : '次', image ? official.output_cost_per_image : undefined, override.per_request_price)]
    }
    return []
  }
  return priceFields.flatMap(([key, label, source, field, scale, unit]) => {
    const base = key === 'cacheWrite1h' && override?.cache_write_price != null && override.cache_write_1h_price == null
      ? override.cache_write_price : field && override?.[field] != null ? override[field] : effective[source]
    // Missing data remains unknown; zero is a real price only when explicitly supplied.
    if (base == null && official[source] == null && !['input', 'output', 'cacheRead'].includes(key)) return []
    return [item(key, label, unit, official[source], base, scale)]
  })
}

export function intervalItems(effective: SourceRecord, override: SourceRecord, intervals: SourceRecord[], rate: string, exchange: string): PriceItem[] {
  return intervals.flatMap(interval => {
    const tier = { ...override }
    for (const [, , , field] of priceFields) {
      if (!field) continue
      const multiplier = interval[field.replace('_price', '_multiplier')]
      if (interval[field] != null) tier[field] = interval[field]
      else if (multiplier != null && tier[field] != null) tier[field] = multiply(tier[field], multiplier)
    }
    const condition = interval.tier_label || `${interval.min_tokens}–${interval.max_tokens ?? '∞'} tokens`
    return calculateItems({}, effective, tier, rate, exchange, condition).map(i => ({ ...i, key: `${i.key}-tier-${interval.id}` }))
  })
}

// Show only variants actually present in the source price card/configuration.
// Channel standard-price overrides retain the catalog's service-tier ratio.
export function serviceTierItems(official: SourceRecord, effective: SourceRecord, override: SourceRecord | undefined, rate: string, exchange: string): PriceItem[] {
  return [['priority', 'Fast / Priority', 'fast_multiplier'], ['flex', 'Flex', 'flex_multiplier'], ['ultrafast', 'Ultrafast', 'ultrafast_multiplier']].flatMap(([suffix, label, multiplierField]) => {
    const suffixKey = `_${suffix}`, o: SourceRecord = {}, e: SourceRecord = {}, tierOverride: SourceRecord = { ...override }
    const explicitMultiplier = decimal(override?.[multiplierField])
    const hasTier = explicitMultiplier !== null || priceFields.some(([, , field]) => effective[field + suffixKey] != null)
    if (!hasTier) return []
    for (const [, , field, channelField] of priceFields) {
      o[field] = official[field + suffixKey]
      e[field] = explicitMultiplier !== null && decimal(effective[field]) !== null ? multiply(effective[field], explicitMultiplier) : effective[field + suffixKey]
      if (channelField && override?.[channelField] != null) {
        const base = decimal(effective[field]), variant = decimal(e[field])
        tierOverride[channelField] = explicitMultiplier !== null ? multiply(override[channelField], explicitMultiplier)
          : base !== null && Number(base) > 0 && variant !== null ? new Decimal(override[channelField]).mul(variant).div(base).toString() : null
      }
    }
    return calculateItems(o, e, tierOverride, rate, exchange, label).filter(i => i.base !== null || i.official !== null).map(i => ({ ...i, key: `${i.key}-${suffix}` }))
  })
}

function longContextRule(card: SourceRecord) {
  const explicit = ['long_context_input_token_threshold', 'long_context_input_cost_multiplier', 'long_context_output_cost_multiplier'].some(k => Object.hasOwn(card, k))
  const thresholds = Object.keys(card).flatMap(k => {
    const match = k.match(/^(input|output)_cost_per_token_above_(\d+)k_tokens$/)
    return match && Number(decimal(card[k])) > 0 ? [Number(match[2]) * 1000] : []
  })
  const threshold = explicit ? Number(card.long_context_input_token_threshold) : Math.min(...thresholds)
  if (!Number.isFinite(threshold) || threshold <= 0) return null
  const ratio = (side: 'input' | 'output') => {
    if (explicit) return Number(decimal(card[`long_context_${side}_cost_multiplier`])) > 0 ? decimal(card[`long_context_${side}_cost_multiplier`])! : '1'
    const base = decimal(card[`${side}_cost_per_token`]), above = decimal(card[`${side}_cost_per_token_above_${threshold / 1000}k_tokens`])
    return base !== null && Number(base) > 0 && above !== null && Number(above) > 0 ? new Decimal(above).div(base).toString() : '1'
  }
  const input = ratio('input'), output = ratio('output')
  return Number(input) > 1 || Number(output) > 1 ? { threshold, input, output } : null
}

export function tieredItems(official: SourceRecord, effective: SourceRecord, rate: string, exchange: string, override?: SourceRecord): PriceItem[] {
  if (override?.billing_mode && !['token', 'tokens'].includes(override.billing_mode)) return []
  const rule = longContextRule(effective)
  if (!rule) return []
  const threshold = rule.threshold / 1000, suffix = `_above_${threshold}k_tokens`, o: SourceRecord = {}, e: SourceRecord = {}
  const referenceRule = longContextRule(official)
  for (const [key, , field, channelField] of priceFields) {
    const multiplier = key === 'output' ? rule.output : ['input', 'cacheRead', 'cacheWrite', 'cacheWrite1h'].includes(key) ? rule.input : '1'
    const base = key === 'cacheWrite1h' && override?.cache_write_price != null && override.cache_write_1h_price == null
      ? override.cache_write_price : channelField && override?.[channelField] != null ? override[channelField] : effective[field]
    e[field] = decimal(base) === null ? null : multiply(base, multiplier)
    const referenceMultiplier = referenceRule && referenceRule.threshold <= rule.threshold
      ? key === 'output' ? referenceRule.output : ['input', 'cacheRead', 'cacheWrite', 'cacheWrite1h'].includes(key) ? referenceRule.input : '1' : '1'
    o[field] = official[field + suffix] ?? (decimal(official[field]) === null ? null : multiply(official[field], referenceMultiplier))
  }
  const inclusive = effective.litellm_provider === 'xai'
  return calculateItems(o, e, undefined, rate, exchange, `输入${inclusive ? '达到' : '超过'} ${threshold}K tokens（含缓存）`).map(i => ({ ...i, key: `${i.key}-above-${threshold}k` }))
}
