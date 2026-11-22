import type { SourceRecord } from './source.js'
import type { PriceItem } from './types.js'
import { calculateItems, intervalItems, priceFields, serviceTierItems, tieredItems } from './pricing.js'

export const usesCnyReference = (platform: string) => ['deepseek', 'zhipu', 'kimi'].includes(platform)

// These platforms' channel prices are configured using RMB face values. Keep
// reference prices separate from group billing overrides and USD source cards.
export function cnyReferenceItems(rule: SourceRecord | undefined, intervals: SourceRecord[]): PriceItem[] {
  if (!rule || (rule.time_pricing && Object.keys(rule.time_pricing).length)) return []
  const card: SourceRecord = { ...rule }
  for (const [, , source, field] of priceFields) card[source] = field ? rule[field] : undefined
  const items = calculateItems({}, {}, rule, '1', '1')
  if (intervals.length) items.push(...intervalItems({}, rule, intervals, '1', '1'))
  else items.push(...tieredItems({}, card, '1', '1', rule))
  if (!rule.billing_mode || ['token', 'tokens'].includes(rule.billing_mode)) {
    items.push(...serviceTierItems({}, card, rule, '1', '1'))
  }
  return items
}

export function withCnyReferences(items: PriceItem[], references: PriceItem[]): PriceItem[] {
  const prices = new Map(references.map(i => [i.key, i.base]))
  return items.map(i => ({ ...i, officialCurrency: 'CNY', official: prices.get(i.key.replace(/-peak$/, '')) ?? null }))
}
