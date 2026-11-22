import type { CatalogGroup, CatalogModel, CatalogPool, PublicCatalog } from '../../server/models/types'

const model = (id: string, platform: string, final: string): CatalogModel => ({ id, platform, kind: 'text', customPricing: false, notes: [], officialSource: null,
  items: [{ key: 'input', label: '输入', unit: '百万 tokens', official: '1', base: '1', final, rate: '4', coefficient: final, officialCurrency: 'USD' }] })
const pool = (key: string, platform: string, name: string, ids: string[], price: string, isDefault = false): CatalogPool => ({
  key, platform, name, isDefault, rate: '4', models: ids.map(id => model(id, platform, price))
})
const group = (id: string, name: string, platform: string, pools: CatalogPool[], isDefault = false): CatalogGroup => ({
  id, name, platform, mode: 'subscription', sourceIds: [id], isDefault, rate: '4', platformRates: {}, cnyPerCredit: '0.03', pools,
  models: [...new Map(pools.flatMap(p => p.models).map(m => [`${m.platform}:${m.id}`, m])).values()]
})

export function directoryPoolFixture(): PublicCatalog {
  const openai = [pool('openai-default', 'openai', 'ChatGPT【稳定】', ['gpt-test'], '0.08', true),
    pool('openai-official', 'openai', 'ChatGPT【官Key】', ['gpt-official'], '0.3')]
  const claude = [pool('claude-default', 'anthropic', 'Claude【默认】', ['claude-test', 'claude-default-only'], '0.12', true),
    pool('claude-pro', 'anthropic', 'Claude【企业】', ['claude-test'], '0.3')]
  const deepseek = [pool('deepseek-default', 'deepseek', 'DeepSeek', ['deepseek-test'], '0.12', true),
    pool('deepseek-official', 'deepseek', 'DeepSeek【官key】', ['deepseek-test', 'deepseek-official-only'], '0.45')]
  const grok = [pool('grok-only', 'grok', 'Grok【企业】', ['grok-test'], '0.21', true)]
  const combined = group('67', '一卡通 订阅', 'composite', [...openai, ...claude, ...deepseek, ...grok])
  const legacy = group('65', 'Grok 订阅', 'grok', grok, true)
  delete legacy.pools
  legacy.models = [model('grok-test', 'grok', '0.02')]
  const balance = { ...group('26', '余额', 'openai', [...openai, ...claude]), mode: 'balance' as const }
  delete balance.pools
  return { updatedAt: new Date().toISOString(), pricingUpdatedAt: '2026-11-01T00:00:00Z', stale: false,
    platforms: [{ id: 'openai', name: 'OpenAI', count: 2 }, { id: 'anthropic', name: 'Claude', count: 2 },
      { id: 'grok', name: 'Grok', count: 1 }, { id: 'deepseek', name: 'DeepSeek', count: 2 }],
    groups: [group('12', 'OpenAI 订阅', 'openai', openai, true), combined, group('44', 'Claude 订阅', 'anthropic', claude), legacy, balance] }
}
