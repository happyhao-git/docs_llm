import { describe, expect, it } from 'vitest'
import { buildPriceComparison, relativePrice } from './comparison'
import type { PriceItem } from './types'

function price(label: string, final: string | null, condition?: string, unit = '百万 tokens'): PriceItem {
  return { key: `${label}-${condition || ''}-${unit}`, label, final, base: final, official: final, unit, coefficient: '0.2', rate: '1', condition }
}

describe('billing scenario comparisons', () => {
  it('aligns prices by billing metric and orders context and service tiers', () => {
    const items = [price('输入', '.1', 'Flex'), price('输入', '.4', 'Fast / Priority'), price('输入', '.4', '输入超过 272K tokens（含缓存）'), price('输出', '1.5', '输入超过 272K tokens（含缓存）'), price('输入', '.2'), price('输出', '1')]
    const comparison = buildPriceComparison(items)
    expect(comparison.columns.map(c => c.label)).toEqual(['标准', '长上下文', 'Fast / Priority', 'Flex'])
    expect(comparison.columns.map(c => c.context)).toEqual(['输入 ≤ 272K token', '输入 > 272K token', '输入 ≤ 272K token', '输入 ≤ 272K token'])
    expect(comparison.rows.map(r => r.label)).toEqual(['输入', '输出'])
    const input = comparison.rows[0]!.id, output = comparison.rows[1]!.id
    expect(relativePrice(comparison.columns[1]!.items.get(input), comparison.standard!.items.get(input))?.label).toBe('2x 标准价')
    expect(relativePrice(comparison.columns[1]!.items.get(output), comparison.standard!.items.get(output))?.label).toBe('1.5x 标准价')
    expect(relativePrice(comparison.columns[3]!.items.get(input), comparison.standard!.items.get(input))?.label).toBe('0.5x 标准价')
    expect(comparison.columns[2]!.items.has(output)).toBe(false)
    expect(items[0]!.condition).toBe('Flex')
  })

  it('preserves inclusive context limits and custom conditions', () => {
    const comparison = buildPriceComparison([price('输入', '1'), price('输入', '2', '输入达到 200K tokens（含缓存）'), price('输入', '3', '输入超过 200K tokens（含缓存） · Fast')])
    expect(comparison.columns[0]!.context).toBe('输入 < 200K token')
    expect(comparison.columns[1]!.context).toBe('输入 ≥ 200K token')
    expect(comparison.columns[2]!.label).toBe('输入超过 200K tokens（含缓存） · Fast')
    expect(comparison.columns[2]!.kind).toBe('other')
  })

  it('never invents prices or a standard tier for missing data', () => {
    expect(buildPriceComparison([]).columns).toEqual([])
    expect(buildPriceComparison([price('输入', '1', 'Flex')]).standard).toBeUndefined()
    expect(relativePrice(price('输入', null), price('输入', '1'))).toBeNull()
    expect(relativePrice(price('输入', '1'), price('输入', '0'))).toBeNull()
    expect(relativePrice(undefined, price('输入', '1'))).toBeNull()
    expect(relativePrice(price('输入', '1'), price('输入', '1'))?.label).toBe('同标准价')
    expect(relativePrice(price('输入', '0'), price('输入', '1'))).toEqual({ label: '0x 标准价', direction: -1 })
  })

  it('keeps separate metrics for different media units', () => {
    const comparison = buildPriceComparison([price('生成', '.1', undefined, '张'), price('生成', '.2', undefined, '秒')])
    expect(comparison.rows.map(r => r.unit)).toEqual(['张', '秒'])
    expect(comparison.columns).toHaveLength(1)
    expect(comparison.columns[0]!.items.size).toBe(2)
    expect(comparison.hasLongContext).toBe(false)
  })
})
