import { describe, expect, it } from 'vitest'
import { Decimal } from 'decimal.js'
import { displayCoefficient, displayedFinal, formatAmount, formatCoefficient, formatPriceAmount, formatUnit } from './presentation'
import type { PriceItem } from './types'

function item(base: string, coefficient: string): PriceItem {
  return { key: 'input', label: '输入', unit: '百万 tokens', base, official: base, coefficient, rate: '4', final: new Decimal(base).mul(coefficient).toString() }
}

describe('customer-facing price precision', () => {
  it('shows equivalent subscription conversions identically for every price scale', () => {
    for (const base of ['1', '5', '.05', '1.25', '2', '7.5', '.1', '2.5', '10', '.5', '.025', '.625', '1000', '.0000001']) {
      const standalone = item(base, '.08'), combined = item(base, '.08001')
      const original = { ...combined }
      expect(displayedFinal(combined, 'subscription')).toBe(displayedFinal(standalone, 'subscription'))
      expect(combined).toEqual(original)
    }
    expect(formatCoefficient('.08001', 'subscription')).toBe('0.08x')
    expect(formatCoefficient('.08', 'subscription')).toBe('0.08x')
  })

  it('preserves meaningful subscription differences and all balance coefficients', () => {
    for (const coefficient of ['.0801', '.081', '.08004']) {
      expect(displayCoefficient(coefficient, 'subscription')).toBe(new Decimal(coefficient).toString())
      expect(displayedFinal(item('5', coefficient), 'subscription')).not.toBe('0.4')
    }
    expect(formatCoefficient('.08001', 'balance')).toBe('0.08001x')
    expect(displayedFinal(item('5', '.08001'), 'balance')).toBe('0.40005')
    // A genuinely different billing base remains different even with the same rounded multiplier.
    expect(displayedFinal(item('1.001', '.08001'), 'subscription')).toBe('0.08008')
  })

  it('preserves missing, zero and very small prices', () => {
    expect(displayedFinal({ ...item('1', '.08'), final: null }, 'subscription')).toBeNull()
    expect(displayedFinal(item('0', '.08001'), 'subscription')).toBe('0')
    expect(displayedFinal(item('1', '0'), 'subscription')).toBe('0')
    expect(formatAmount(displayedFinal(item('.0000001', '.08001'), 'subscription')!, true)).toBe('8.00e-9')
    expect(formatCoefficient('0', 'subscription')).toBe('0x')
  })

  it('keeps token units consistent without changing media billing units', () => {
    expect(formatUnit('百万 tokens')).toBe('1M token')
    expect(formatUnit('百万图片 tokens')).toBe('1M 图片 token')
    expect(formatUnit('张')).toBe('张')
    expect(formatUnit('秒')).toBe('秒')
  })

  it('rounds the image list to cents while retaining exact detail prices and source values', () => {
    for (const [value, shown] of [['.06', '0.06'], ['.0798', '0.08'], ['.0999', '0.10'], ['.1', '0.10'], ['0', '0.00'], ['.0001', '0.0001']]) {
      const price = { ...item('1', '.03'), final: value }, original = { ...price }
      expect(formatPriceAmount(price, 'subscription', 'cents')).toBe(shown)
      expect(formatPriceAmount(price, 'subscription', 'exact')).toBe(new Decimal(value).toString())
      expect(price).toEqual(original)
    }
    // Image details must not inherit the text subscription coefficient rounding.
    expect(formatPriceAmount(item('1', '.08001'), 'subscription', 'exact')).toBe('0.08001')
    expect(formatPriceAmount({ ...item('1', '.03'), final: null }, 'subscription', 'cents')).toBe('—')
  })
})
