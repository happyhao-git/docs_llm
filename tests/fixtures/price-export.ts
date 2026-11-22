// Isolated synthetic pricing data for export tests; never loaded by the application.
import type { CatalogGroup, CatalogModel, PriceItem, PublicCatalog } from '../../server/models/types.js'

export const priceItem = (key: string, value: string | null, extra: Partial<PriceItem> = {}): PriceItem => ({
  key, label: { input: '输入', output: '输出', cacheRead: '缓存命中' }[key] || key, unit: '百万 tokens',
  official: '1', base: '1', final: value, rate: '4', coefficient: '0.08', ...extra
})
export const priceModel = (id: string, extra: Partial<CatalogModel> = {}): CatalogModel => ({
  id, platform: 'openai', kind: 'text', items: [priceItem('input', '0.08001', { coefficient: '0.08001' }), priceItem('output', '0.4', { official: '5' }), priceItem('cacheRead', '0', { official: '0' })],
  customPricing: false, notes: [], officialSource: null, ...extra
})
export function priceCatalog(): PublicCatalog {
  const group = (id: string, models: CatalogModel[], extra: Partial<CatalogGroup> = {}): CatalogGroup => ({ id, sourceIds: [id], name: 'OpenAI 订阅',
    platform: 'openai', mode: 'subscription', rate: '4', platformRates: {}, cnyPerCredit: '0.02', isDefault: true, models, ...extra })
  const text = priceModel('gpt-test', { items: [...priceModel('gpt-test').items,
    priceItem('input-long', '0.16', { official: '2', condition: '输入超过 272K tokens（含缓存）' }),
    priceItem('input-fast', '0.16', { official: '2', condition: 'Fast / Priority' }),
    priceItem('input-flex', '0.04', { official: '0.5', condition: 'Flex' })] })
  const image = priceModel('image-test', { kind: 'image', items: ['1k', '2k', '4k'].map((r, i) => priceItem(`image-${r}`, ['0.06', '0.0798', '0.0999'][i],
    { label: `${r.toUpperCase()} 图片`, unit: '张', official: null, base: String(i + 3), coefficient: '0.02', rate: '1' })) })
  return {
    updatedAt: '2026-11-05T01:00:00.000Z', pricingUpdatedAt: '2026-11-04T01:00:00.000Z', stale: false,
    platforms: [{ id: 'openai', name: 'OpenAI', count: 3 }, { id: 'deepseek', name: 'DeepSeek', count: 1 }],
    groups: [group('12', [text, image, priceModel('unknown-test', { items: [priceItem('input', null, { official: null })] })]),
      group('67', [text, image], { name: '一卡通', isDefault: false }),
      group('26', [priceModel('gpt-test', { items: [priceItem('input', '0.2', { coefficient: '0.2', rate: '1' })] })], { name: 'OpenAI 余额', mode: 'balance' }),
      group('114', [priceModel('deepseek-test', { platform: 'deepseek', items: [priceItem('input', '1.8', { official: '9', officialCurrency: 'CNY', coefficient: '0.2', rate: '1' })] })], { name: 'DeepSeek 余额', mode: 'balance', platform: 'deepseek' })]
  }
}
