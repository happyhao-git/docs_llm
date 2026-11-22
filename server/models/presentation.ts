import { Decimal } from 'decimal.js'
import type { BillingMode, CatalogModel, PriceItem } from './types.js'

export const IMAGE_RESOLUTIONS = ['1k', '2k', '4k'] as const
export const hasResolutionPricing = (model: CatalogModel) => model.kind === 'image'
  && IMAGE_RESOLUTIONS.every(size => model.items.some(item => item.key === `image-${size}` && item.unit === '张'))
export type PricePrecision = 'default' | 'cents' | 'exact'

export const kindNames: Record<string, string> = { text: '文本对话', image: '图片生成', video: '视频生成', audio: '音频', embedding: '向量与检索', other: '其他' }
const compactNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 })
const fixedNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6, minimumFractionDigits: 2 })
export function formatAmount(value: string, compact = false) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  if (number === 0) return '0'
  if (number < 0.000001) return number.toExponential(2)
  return (!compact && number >= 1 ? fixedNumber : compactNumber).format(number)
}
export function displayCoefficient(value: string, billing?: BillingMode) {
  const exact = new Decimal(value)
  if (billing !== 'subscription' || !exact.gt(0)) return exact.toString()
  // Suppress only tiny subscription-conversion residues (e.g. 2.667 × .03).
  // Larger differences and all balance rates retain their original precision.
  const rounded = exact.toSignificantDigits(3)
  return rounded.minus(exact).abs().div(exact).lte('0.0002') ? rounded.toString() : exact.toString()
}
export function formatCoefficient(value: string, billing?: BillingMode) {
  return `${displayCoefficient(value, billing)}x`
}
export function displayedFinal(item: PriceItem, billing?: BillingMode): string | null {
  if (item.final === null) return null
  const coefficient = new Decimal(item.coefficient)
  if (billing !== 'subscription' || coefficient.isZero()) return item.final
  return new Decimal(item.final).div(coefficient).mul(displayCoefficient(item.coefficient, billing)).toString()
}
export function formatPriceAmount(item: PriceItem, billing?: BillingMode, precision: PricePrecision = 'default') {
  if (item.final === null) return '—'
  if (precision === 'default') return formatAmount(displayedFinal(item, billing)!, true)
  const exact = new Decimal(item.final)
  if (precision === 'exact') return exact.toString()
  const rounded = exact.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  // A positive sub-cent price must never be presented as free.
  return exact.gt(0) && rounded.isZero() ? exact.toString() : rounded.toFixed(2)
}
export function formatUnit(unit: string) {
  return unit.replace(/^百万/, '1M ').replace(/tokens\b/g, 'token').replace(/\s+/g, ' ').trim()
}
export const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '尚未同步'

