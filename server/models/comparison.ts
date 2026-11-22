import { Decimal } from 'decimal.js'
import type { PriceItem } from './types.js'

export interface PriceScenario {
  id: string
  label: string
  context: string
  kind: 'standard' | 'context' | 'priority' | 'flex' | 'other'
  items: Map<string, PriceItem>
}
export interface PriceMetric { id: string; label: string; unit: string }

const metricKey = (item: PriceItem) => `${item.label}\u0000${item.unit}`

function describe(condition: string): Omit<PriceScenario, 'items'> {
  if (!condition) return { id: '', label: '标准', context: '', kind: 'standard' }
  const context = condition.match(/^输入(超过|达到)\s*([\d.]+)K\s*tokens?(?:（含缓存）)?$/)
  if (context) return { id: condition, label: '长上下文', context: `输入 ${context[1] === '达到' ? '≥' : '>'} ${context[2]}K token`, kind: 'context' }
  if (condition === 'Fast / Priority') return { id: condition, label: 'Fast / Priority', context: '', kind: 'priority' }
  if (condition === 'Flex') return { id: condition, label: 'Flex', context: '', kind: 'flex' }
  return { id: condition, label: condition, context: '', kind: 'other' }
}

export function buildPriceComparison(items: PriceItem[]) {
  const scenarios = new Map<string, PriceScenario>(), metrics = new Map<string, PriceMetric>()
  for (const item of items) {
    const condition = item.condition || '', key = metricKey(item)
    if (!scenarios.has(condition)) scenarios.set(condition, { ...describe(condition), items: new Map() })
    scenarios.get(condition)!.items.set(key, item)
    if (!metrics.has(key)) metrics.set(key, { id: key, label: item.label, unit: item.unit })
  }
  const order = ['standard', 'context', 'priority', 'flex', 'other']
  const columns = [...scenarios.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
  const firstContext = columns.find(s => s.kind === 'context')
  const boundary = firstContext?.context.match(/(≥|>)\s*([\d.]+K token)/)
  for (const column of columns) {
    if (['standard', 'priority', 'flex'].includes(column.kind) && boundary) column.context = `输入 ${boundary[1] === '≥' ? '<' : '≤'} ${boundary[2]}`
  }
  return { columns, rows: [...metrics.values()], standard: scenarios.get(''), hasLongContext: !!firstContext }
}

export function relativePrice(item?: PriceItem, standard?: PriceItem) {
  if (!item || !standard || item.final === null || standard.final === null || !new Decimal(standard.final).gt(0)) return null
  const ratio = new Decimal(item.final).div(standard.final)
  return { label: ratio.eq(1) ? '同标准价' : `${ratio.toSignificantDigits(4).toString()}x 标准价`, direction: ratio.cmp(1) }
}
