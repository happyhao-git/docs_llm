import { createHash } from 'node:crypto'
import type { ModelSource, SourceRecord } from './source.js'
import { calculateItems, decimal, identifyKind, intervalItems, multiply, rateFor, serviceTierItems, tieredItems } from './pricing.js'
import { cnyReferenceItems, usesCnyReference, withCnyReferences } from './cny-pricing.js'
import { compareModelOrder } from './order.js'
import { officialPriceCard } from './official-prices.js'
import { modelRelease } from './releases.js'
import { PLATFORM_NAMES, type CatalogGroup, type CatalogModel, type CatalogSnapshot, type PlazaSettings, type PublicCatalog } from './types.js'

export const defaultSettings = (): PlazaSettings => ({ groups: [], exchange: { balance: '0.2', openaiSubscription: '0.02', otherSubscription: '0.03' } })
const modeFor = (g: SourceRecord) => g.subscription_type === 'subscription' ? 'subscription' as const : 'balance' as const
export function initialSettings(source: ModelSource): PlazaSettings {
  return { ...defaultSettings(), groups: source.groups.map((g, index) => ({ id: String(g.id), name: '',
    visible: !/test|测试|vip/i.test(g.name) && (g.subscription_type === 'subscription' || !g.is_exclusive),
    order: index, isDefault: String(g.id) === '12' || /个人稳定|Plus.*稳定/.test(g.name) })) }
}
const match = (pattern: string, name: string) => {
  if (pattern.length > 200) return false
  const expression = pattern.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${expression}$`).test(name)
}
function modelPlatform(name: string, fallback: string) {
  if (/^(gpt-|chatgpt|codex-|dall-e|o[134]-)/i.test(name)) return 'openai'
  if (/^claude-/i.test(name)) return 'anthropic'
  if (/^grok-|^composer-/i.test(name)) return 'grok'
  if (/^gemini-/i.test(name)) return 'gemini'
  if (/^deepseek-/i.test(name)) return 'deepseek'
  if (/^kimi-|^k[23]$/i.test(name)) return 'kimi'
  if (/^glm-/i.test(name)) return 'zhipu'
  return fallback
}
function safeSource(value: unknown) {
  if (typeof value !== 'string') return null
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search ? url.toString() : null } catch { return null }
}

export function buildSnapshot(source: ModelSource, settings: PlazaSettings, now = new Date()): CatalogSnapshot {
  const warnings = new Set<string>()
  const buildGroup = (g: SourceRecord, mappings = source.mappings): CatalogGroup => {
    const id = String(g.id), mode = modeFor(g)
    const exchange = mode === 'balance' ? settings.exchange.balance : g.platform === 'openai' ? settings.exchange.openaiSubscription : settings.exchange.otherSubscription
    const channels = source.channels.filter(c => String(c.group_id) === id)
    const candidates = new Map<string, { platform: string; targets: Set<string> }>()
    const add = (name: string, platform: string, target: string) => {
      if (!name || name.startsWith('__') || name.includes('*') || name.length > 200) return
      const resolvedPlatform = modelPlatform(name, platform)
      const key = `${resolvedPlatform}:${name}`
      const entry = candidates.get(key) || { platform: resolvedPlatform, targets: new Set<string>() }
      entry.targets.add(target); candidates.set(key, entry)
    }
    for (const a of mappings.filter(a => String(a.group_id) === id)) {
      if (!a.mapping || typeof a.mapping !== 'object') { warnings.add(`${g.name} 存在未明确列出模型的通道`); continue }
      for (const [name, target] of Object.entries(a.mapping)) if (typeof target === 'string' && !target.startsWith('__')) add(name, a.platform, target)
    }
    for (const r of source.routes.filter(r => String(r.group_id) === id)) {
      const reachable = mappings.some(a => String(a.group_id) === id && a.platform === r.target_platform && Object.keys(a.mapping || {}).some(n => match(n, r.upstream_model)))
      if (reachable && !String(r.public_model).includes('*')) add(r.public_model, r.target_platform, r.upstream_model)
    }
    const models: CatalogModel[] = []
    for (const [key, entry] of candidates) {
      const name = key.slice(key.indexOf(':') + 1), platform = entry.platform
      if (g.model_allowlist?.enabled && !g.model_allowlist.models?.some((p: string) => match(p, name))) continue
      if (channels.some(c => c.restrict_models && !Object.keys(c.model_mapping || {}).some(p => match(p, name)))) continue
      const official = officialPriceCard(name, source.official)
      const kind = identifyKind(name, official)
      if (kind === 'image' && !g.allow_image_generation) continue
      if (/realtime/.test(name) && !g.allow_live) continue
      // OpenAI image requests use the group's resolution prices even when the
      // optional count-billing flag is off. Other platforms retain that flag.
      const resolutionPricing = kind === 'image' && (platform === 'openai' || !!g.image_count_billing)
      const rate = rateFor(g, platform, kind)
      if (rate === null) { warnings.add(`${g.name} 倍率无效`); continue }
      const notes: string[] = []
      let effective = official
      if (!resolutionPricing && channels.some(c => c.billing_model_source !== 'requested')) {
        const targets = [...entry.targets]
        if (targets.length === 1) effective = officialPriceCard(targets[0], source.official)
        else { effective = {}; warnings.add(`${g.name} / ${name}：路由计费基准不同`) }
      }
      const overrides = resolutionPricing ? [] : source.prices.filter(p => channels.some(c => String(c.id) === String(p.channel_id)) && (!p.platform || p.platform === platform) && Array.isArray(p.models) && p.models.some((n: string) => match(n, name)))
      // Exact configured matches take precedence over a wildcard rule.
      const exact = overrides.filter(p => p.models.includes(name))
      let override = (exact.length ? exact : overrides)[0]
      let uncertain = (exact.length ? exact : overrides).length > 1
      const referenceRule = uncertain ? undefined : override
      if (uncertain) warnings.add(`${g.name} / ${name}：多个计费规则命中`)
      if (!resolutionPricing && Array.isArray(g.model_pricing) && g.model_pricing.length) {
        const groupRules = g.model_pricing.filter((p: SourceRecord) => Array.isArray(p.models) && p.models.some((n: string) => match(n, name)))
        if (groupRules.length === 1) override = groupRules[0]
        else if (groupRules.length > 1) { uncertain = true; warnings.add(`${g.name} / ${name}：分组计费规则存在歧义`) }
      }
      if (!resolutionPricing && g.model_routing_enabled) { uncertain = true; warnings.add(`${g.name} / ${name}：模型路由计费待核对`) }
      if (override?.time_pricing && Object.keys(override.time_pricing).length) { uncertain = true; warnings.add(`${g.name} / ${name}：分时价格待核对`) }
      if (!resolutionPricing && g.force_openai_fast && !g.free_openai_fast) { uncertain = true; warnings.add(`${g.name} / ${name}：强制快速模式价格待核对`) }
      if (platform === 'deepseek' && !override) { uncertain = true; warnings.add(`${g.name} / ${name}：默认价卡峰谷策略待核对`) }
      const intervals = override ? source.intervals.filter(i => String(i.pricing_id) === String(override.id)) : []
      let items = calculateItems(official, effective, override, rate, exchange)
      if (resolutionPricing) {
        items = ['1k', '2k', '4k'].map(size => {
          const base = decimal(g[`image_price_${size}`])
          return { key: `image-${size}`, label: `${size.toUpperCase()} 图片`, unit: '张', official: null, base,
            final: base === null ? null : multiply(base, rate, exchange), rate, coefficient: multiply(rate, exchange) }
        })
      } else if (!intervals.length && g.long_context_pricing_enabled !== false) {
        items.push(...tieredItems(official, effective, rate, exchange, override))
      }
      if (override) items.push(...intervalItems(effective, override, intervals, rate, exchange))
      if (g.peak_rate_enabled) {
        const peak = decimal(g.peak_rate_multiplier)
        if (peak !== null) items.push(...items.filter(i => !i.condition).map(i => ({ ...i, key: `${i.key}-peak`, condition: `高峰时段 ${g.peak_start}–${g.peak_end}（站点时区）`, rate: multiply(i.rate, peak), coefficient: multiply(i.coefficient, peak), final: i.final === null ? null : multiply(i.final, peak) })))
      }
      if (kind === 'text') {
        items = items.filter(i => !/^(image|audio|perImage|perSecond|characters)/.test(i.key))
        const serviceItems = serviceTierItems(official, effective, override, rate, exchange)
        items.push(...serviceItems)
        if (serviceItems.length && items.some(i => i.key.includes('-above-'))) notes.push('服务档价格以基础上下文为准；长上下文与服务档倍率可能叠加')
      }
      if (kind === 'video') {
        const perModel = g.video_model_prices?.[name] || {}
        for (const resolution of ['480p', '720p', '1080p']) {
          const base = decimal(perModel[resolution] ?? g[`video_price_${resolution}`])
          if (base !== null) items.push({ key: `video-${resolution}`, label: `${resolution} 视频`, unit: '秒', official: null, base, final: multiply(base, rate, exchange), rate, coefficient: multiply(rate, exchange) })
        }
      }
      if (kind === 'audio' && platform === 'grok') {
        const field = /tts/.test(name) ? 'audio_tts_price_per_million_chars' : /stt|transcri/.test(name) ? 'audio_stt_price_per_hour' : 'audio_realtime_price_per_min'
        const base = decimal(g[field]), unit = field.includes('tts') ? '百万字符' : field.includes('stt') ? '小时' : '分钟'
        if (base !== null) items = [{ key: field, label: '音频处理', unit, official: null, base, final: multiply(base, rate, exchange), rate, coefficient: multiply(rate, exchange) }]
      }
      if (uncertain) items = items.map(i => ({ ...i, base: null, final: null }))
      if (usesCnyReference(platform)) {
        const referenceIntervals = referenceRule ? source.intervals.filter(i => String(i.pricing_id) === String(referenceRule.id)) : []
        items = withCnyReferences(items, cnyReferenceItems(referenceRule, referenceIntervals))
      } else items = items.map(i => ({ ...i, officialCurrency: 'USD' }))
      if (!items.some(i => i.final !== null)) {
        warnings.add(`${PLATFORM_NAMES[platform] || platform} / ${name}：暂无完整计费基准`)
      }
      if (kind === 'image' && g.image_rate_independent && !resolutionPricing) notes.push('图片使用独立扣费倍率')
      models.push({ id: name, platform, kind, items, ...modelRelease(name, official, now), customPricing: !!override || resolutionPricing, notes, officialSource: resolutionPricing || usesCnyReference(platform) ? null : safeSource(official.source) })
    }
    models.sort(compareModelOrder)
    return { id, sourceIds: [id], name: g.name, platform: g.platform, mode, rate: decimal(g.rate_multiplier) || '0', platformRates: g.platform_rate_multipliers || {}, cnyPerCredit: exchange, isDefault: false, models }
  }
  const groups = source.groups.map(g => {
    if (modeFor(g) !== 'subscription' || !source.poolGroupIds?.includes(String(g.id))) return buildGroup(g)
    const group = buildGroup(g, [])
    group.pools = (source.pools || []).filter(p => String(p.group_id) === String(g.id)).map(p => {
      const rate = decimal(p.rate_multiplier)
      if (rate === null) { warnings.add(`${g.name} / ${p.name}：账号池倍率无效`); return null }
      // Pool rates replace the platform rate, while independent image/video rates retain precedence.
      const configured = { ...g, platform_rate_multipliers: { ...g.platform_rate_multipliers, [p.platform]: rate } }
      const models = buildGroup(configured, (source.poolMappings || []).filter(m => String(m.pool_id) === String(p.id))).models.filter(m => m.platform === p.platform)
      return { key: `${p.platform}-${createHash('sha256').update(p.name).digest('hex').slice(0, 16)}`, name: String(p.name), platform: String(p.platform),
        rate, isDefault: !!p.is_default, models }
    }).filter(p => p !== null)
    const models = new Map<string, CatalogModel>()
    for (const p of group.pools) for (const m of p.models) if (!models.has(`${m.platform}:${m.id}`)) models.set(`${m.platform}:${m.id}`, m)
    group.models = [...models.values()].sort(compareModelOrder)
    return group
  })
  return { version: 1, updatedAt: now.toISOString(), pricingUpdatedAt: source.pricingUpdatedAt, groups,
    inventory: groups.map(g => ({ id: g.id, name: g.name, platform: g.platform, mode: g.mode, rate: g.rate, modelCount: g.models.length })), warnings: [...warnings] }
}

export function publicCatalog(snapshot: CatalogSnapshot, settings: PlazaSettings, syncFailed = false, now = Date.now()): PublicCatalog {
  const result: CatalogGroup[] = [], signatures = new Map<string, CatalogGroup>()
  const configured = new Map(settings.groups.map(g => [g.id, g]))
  const sorted = [...snapshot.groups].sort((a, b) => (configured.get(a.id)?.order ?? 99999) - (configured.get(b.id)?.order ?? 99999))
  for (const group of sorted) {
    const setting = configured.get(group.id)
    if (!setting?.visible || !group.models.length) continue
    const exchange = group.mode === 'balance' ? settings.exchange.balance : group.platform === 'openai' ? settings.exchange.openaiSubscription : settings.exchange.otherSubscription
    const pricedModels = (models: CatalogModel[]) => [...models].sort(compareModelOrder).map(m => ({ ...m, items: m.items.map(i => ({ ...i, coefficient: multiply(i.rate, exchange), final: i.base === null ? null : multiply(i.base, i.rate, exchange) })) }))
    const g: CatalogGroup = { ...group, sourceIds: [...group.sourceIds], isDefault: setting.isDefault, cnyPerCredit: exchange,
      name: setting.name || (group.mode === 'subscription' ? `${PLATFORM_NAMES[group.platform] || group.platform} 订阅` : group.name),
      models: pricedModels(group.models), ...(group.pools ? { pools: group.pools.map(p => ({ ...p, models: pricedModels(p.models) })) } : {}) }
    const normalizedRates = [...new Set(g.models.map(m => m.platform))].sort().map(p => [p, String(g.platformRates[p] ?? g.rate)])
    const signature = createHash('sha256').update(JSON.stringify([g.name, g.platform, g.mode, g.rate, normalizedRates, g.cnyPerCredit, g.models, g.pools])).digest('hex')
    const previous = signatures.get(signature)
    if (g.mode === 'subscription' && previous) { previous.sourceIds.push(g.id); previous.isDefault ||= g.isDefault }
    else { result.push(g); signatures.set(signature, g) }
  }
  // Equal labels must not hide genuinely different prices/support sets.
  const duplicateNames = new Set(result.filter(g => result.some(other => other !== g && other.mode === g.mode && other.name === g.name)).map(g => `${g.mode}:${g.name}`))
  for (const g of result) if (duplicateNames.has(`${g.mode}:${g.name}`)) {
    const original = snapshot.groups.find(item => item.id === g.id)
    if (original) g.name = `${g.name} · ${original.name}`
  }
  const platformModels = new Map<string, Set<string>>()
  for (const g of result) for (const m of g.models) { const set = platformModels.get(m.platform) || new Set(); set.add(m.id); platformModels.set(m.platform, set) }
  const order = Object.keys(PLATFORM_NAMES)
  return { updatedAt: snapshot.updatedAt, pricingUpdatedAt: snapshot.pricingUpdatedAt,
    stale: syncFailed || now - Date.parse(snapshot.updatedAt) > 15 * 60 * 1000, groups: result,
    platforms: [...platformModels].map(([id, models]) => ({ id, name: PLATFORM_NAMES[id] || id, count: models.size })).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)) }
}
