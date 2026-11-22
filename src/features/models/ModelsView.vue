<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMediaQuery } from '@vueuse/core'
import { ArrowUpRight, Search, X, ChevronDown, Copy, Check, SlidersHorizontal, Info, RefreshCw, Layers3, ArrowRight } from 'lucide-vue-next'
import SiteHeader from '@/components/site/SiteHeader.vue'
import { useSite } from '@/components/site/use-site'
import { useDialog } from '@/lib/use-dialog'
import { CATALOG_CACHE_KEY, CATALOG_FRESH_TTL, modelCatalog } from './catalog-cache'
import PriceCell from './PriceCell.vue'
import PriceComparison from './PriceComparison.vue'
import ImagePriceDetails from './ImagePriceDetails.vue'
import AllModelsDirectory from './AllModelsDirectory.vue'
import ExportPricesButton from './ExportPricesButton.vue'
import AccountPoolSelect from './AccountPoolSelect.vue'
import { dateLabel, formatAmount, formatCoefficient, formatUnit, hasResolutionPricing, IMAGE_RESOLUTIONS, kindNames } from './presentation'
import type { PublicCatalog, CatalogModel, PriceItem } from './types'
import './models.css'
const route = useRoute(), router = useRouter()
const { theme } = useSite()
const platformIcon = (id: string) => `/platform-icons/${id === 'kimi' && theme.value === 'dark' ? 'kimi-dark' : id}.svg?v=20261104b`
const catalog = shallowRef<PublicCatalog | null>(modelCatalog.peek()), loading = ref(!catalog.value), error = ref(''), refreshing = ref(false)
const refreshCooldown = ref(0), refreshMessage = ref(''), exportMessage = ref('')
let cooldownTimer: ReturnType<typeof setInterval> | undefined
const sidebarOpen = ref(false), sidebarRoot = ref<HTMLElement | null>(null), expanded = ref(new Set<string>())
const showCoefficient = useMediaQuery('(min-width: 1101px)')
const search = ref(String(route.query.q || '')), copied = ref(''), copyError = ref('')
let timer: ReturnType<typeof setInterval> | undefined, copyTimer: ReturnType<typeof setTimeout> | undefined, searchTimer: ReturnType<typeof setTimeout> | undefined
let disposed = false
useDialog(sidebarOpen, sidebarRoot, () => { sidebarOpen.value = false })
const platform = computed(() => {
  const requested = String(route.query.platform || 'openai')
  if (requested === 'all') return 'all'
  return catalog.value?.platforms.some(p => p.id === requested) ? requested : catalog.value?.platforms[0]?.id || 'openai'
})
const platformLabel = computed(() => platform.value === 'all' ? '全部模型' : catalog.value?.platforms.find(p => p.id === platform.value)?.name || 'OpenAI')
const mode = computed(() => route.query.billing === 'balance' ? 'balance' : 'subscription')
const kind = computed(() => typeof route.query.type === 'string' && kindNames[route.query.type] ? route.query.type : 'all')
const groups = computed(() => catalog.value?.groups.filter(g => g.mode === mode.value && g.models.some(m => m.platform === platform.value)) || [])
const group = computed(() => groups.value.find(g => g.sourceIds.includes(String(route.query.group))) || groups.value.find(g => g.isDefault) || groups.value.find(g => g.platform === platform.value) || groups.value[0])
const pools = computed(() => mode.value === 'subscription' ? group.value?.pools?.filter(p => p.platform === platform.value) || [] : [])
const selectedPool = computed(() => pools.value.find(p => p.key === route.query.pool) || pools.value.find(p => p.isDefault) || pools.value[0])
const models = computed(() => group.value?.pools && mode.value === 'subscription' ? selectedPool.value?.models || [] : group.value?.models.filter(m => m.platform === platform.value) || [])
const kinds = computed(() => Object.keys(kindNames).filter(k => models.value.some(m => m.kind === k)))
const visible = computed(() => models.value.filter(m => (kind.value === 'all' || m.kind === kind.value) && m.id.toLowerCase().includes(search.value.trim().toLowerCase())))
const sections = computed(() => Object.keys(kindNames).map(k => {
  const items = visible.value.filter(m => m.kind === k)
  return { kind: k, name: kindNames[k], models: items, resolutionPricing: k === 'image' && items.every(hasResolutionPricing) }
}).filter(s => s.models.length))
const exportRows = computed(() => sections.value.flatMap(section => section.models.map(model => ({ platform: model.platform, modelId: model.id, groupId: group.value?.id ?? null, poolKey: selectedPool.value?.key }))))
const imageOnly = computed(() => visible.value.length > 0 && visible.value.every(hasResolutionPricing))
const referenceCurrencies = computed(() => [...new Set(models.value.flatMap(m => m.items.map(i => i.officialCurrency || 'USD')))])
const referenceCurrencyLabel = computed(() => referenceCurrencies.value.map(c => c === 'CNY' ? '人民币（CNY）' : '美元（USD）').join(' / '))
const referenceUpdatedAt = computed(() => referenceCurrencies.value.includes('CNY') ? catalog.value?.updatedAt : catalog.value?.pricingUpdatedAt)
const summaryRateLabel = computed(() => imageOnly.value ? '图片倍率' : visible.value.some(m => ['text', 'embedding'].includes(m.kind)) ? '文本倍率' : '倍率')
function imageRate(models: CatalogModel[]) {
  const rates = [...new Set(models.flatMap(m => m.items.filter(i => !i.condition).map(i => i.rate)))]
  return rates.length === 1 ? formatCoefficient(rates[0]) : '按模型'
}
const rate = computed(() => selectedPool.value?.rate || group.value?.platformRates[platform.value]?.toString() || group.value?.rate || '')
const coefficient = computed(() => models.value.find(m => m.kind === 'text')?.items[0]?.coefficient)
const exchangeLabel = computed(() => group.value ? mode.value === 'balance' ? `¥${formatAmount(String(Number(group.value.cnyPerCredit) * 5))} / 5 额度` : `¥${formatAmount(String(Number(group.value.cnyPerCredit) * 100))} / 100 额度` : '')
const supportedCount = computed(() => new Set(catalog.value?.groups.flatMap(g => g.models.map(m => `${m.platform}:${m.id}`))).size)
function setQuery(values: Record<string, string | undefined>) { void router.replace({ path: '/models', query: { ...route.query, ...values } }) }
function selectPlatform(value: string) {
  sidebarOpen.value = false
  expanded.value = new Set()
  const balanceGroups = value === 'openai' ? catalog.value?.groups.filter(g => g.mode === 'balance' && g.models.some(m => m.platform === value)) || [] : []
  const defaultGroup = balanceGroups.find(g => g.isDefault) || balanceGroups[0]
  setQuery({ platform: value, vendor: undefined, group: defaultGroup?.id, type: undefined, pool: undefined, ...(defaultGroup ? { billing: 'balance' } : {}) })
}
function selectMode(value: string) { expanded.value = new Set(); setQuery({ billing: value, group: undefined, type: undefined, pool: undefined }) }
function toggle(model: CatalogModel) { const next = new Set(expanded.value); next.has(model.id) ? next.delete(model.id) : next.add(model.id); expanded.value = next }
const mainItem = (m: CatalogModel, key: string): PriceItem | undefined => m.items.find(i => i.key === key && !i.condition)
const firstPrices = (m: CatalogModel) => m.items.filter(i => i.final !== null && !i.condition).slice(0, 3)
async function copy(name: string) {
  try { await navigator.clipboard.writeText(name); copied.value = name; copyError.value = ''; clearTimeout(copyTimer); copyTimer = setTimeout(() => { copied.value = '' }, 1800) }
  catch { copyError.value = '无法自动复制，请选中模型 ID 后复制。' }
}
async function load(force = false) {
  if (refreshing.value) return
  refreshing.value = true
  try {
    const next = await modelCatalog.load(force)
    if (!disposed) { catalog.value = next; error.value = '' }
  } catch (e) { if (!disposed) error.value = e instanceof Error ? e.message : '暂时无法加载模型列表' }
  finally { if (!disposed) { loading.value = false; refreshing.value = false } }
}
async function refreshCatalog() {
  if (refreshing.value || refreshCooldown.value > 0) return
  refreshing.value = true
  refreshMessage.value = ''
  try {
    const result = await modelCatalog.refresh()
    if (disposed) return
    catalog.value = result.catalog
    error.value = result.status === 'failed' ? '更新失败，已保留上次结果。' : ''
    refreshMessage.value = result.status === 'updated' ? '列表已更新' : result.status === 'busy' ? '列表正在更新，请稍后重试。' : ''
    refreshCooldown.value = result.retryAfterSeconds
    const availableAt = Date.now() + result.retryAfterSeconds * 1000
    clearInterval(cooldownTimer)
    if (refreshCooldown.value > 0) cooldownTimer = setInterval(() => {
      refreshCooldown.value = Math.max(0, Math.ceil((availableAt - Date.now()) / 1000))
      if (!refreshCooldown.value) { clearInterval(cooldownTimer); refreshMessage.value = '' }
    }, 1000)
  } catch (e) { if (!disposed) error.value = e instanceof Error ? e.message : '暂时无法更新模型列表' }
  finally { if (!disposed) { refreshing.value = false; loading.value = false } }
}
function onVisible() { if (document.visibilityState === 'visible') void load() }
function onOnline() { void load(true) }
function onStorage(event: StorageEvent) {
  if (event.key === CATALOG_CACHE_KEY) {
    // Other tabs already changed storage; do not write back or create an event loop.
    modelCatalog.invalidate(false)
    if (document.visibilityState === 'visible') void load(event.newValue === null)
  }
}
watch(search, value => { clearTimeout(searchTimer); searchTimer = setTimeout(() => setQuery({ q: value || undefined }), 250) })
watch(() => route.query.q, value => { if (String(value || '') !== search.value) search.value = String(value || '') })
watch(() => group.value?.id, () => { expanded.value = new Set() })
watch(() => selectedPool.value?.key, () => { expanded.value = new Set() })
onMounted(() => { void load(); timer = setInterval(onVisible, CATALOG_FRESH_TTL); document.addEventListener('visibilitychange', onVisible); window.addEventListener('online', onOnline); window.addEventListener('storage', onStorage) })
onBeforeUnmount(() => { disposed = true; clearInterval(timer); clearInterval(cooldownTimer); clearTimeout(copyTimer); clearTimeout(searchTimer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onOnline); window.removeEventListener('storage', onStorage) })
</script>

<template>
  <div class="models-app">
    <a class="skip-to-content" href="#models-content">跳转到模型列表</a>
    <SiteHeader active="models" />
    <div class="models-shell">
      <div v-if="sidebarOpen" class="sidebar-backdrop" @click="sidebarOpen = false" />
      <aside ref="sidebarRoot" class="models-sidebar" :class="{ open: sidebarOpen }" :role="sidebarOpen ? 'dialog' : undefined" :aria-modal="sidebarOpen ? true : undefined" aria-label="模型平台">
        <nav aria-label="按平台筛选" class="platform-list">
          <button class="platform-all" type="button" :class="{ active: platform === 'all' }" :aria-pressed="platform === 'all'" @click="selectPlatform('all')"><Layers3 :size="24" /><span>全部模型</span><small>{{ supportedCount || '—' }}</small></button>
          <button v-for="p in catalog?.platforms" :key="p.id" type="button" :class="{ active: platform === p.id }" :aria-pressed="platform === p.id" @click="selectPlatform(p.id)">
            <img class="platform-icon" :data-platform="p.id" :src="platformIcon(p.id)" alt="" aria-hidden="true" width="24" height="24" loading="lazy" decoding="async" />
            <span>{{ p.name }}</span><small>{{ p.count }}</small>
          </button>
        </nav>
      </aside>
      <main id="models-content" class="models-main" tabindex="-1">
        <div v-if="loading" class="models-skeleton" role="status" aria-label="正在加载模型目录"><div v-for="i in 7" :key="i" /></div>
        <section v-else-if="!catalog" class="models-empty" role="alert"><Layers3 :size="32" /><h2>目录暂时不可用</h2><p>{{ error }}</p><button class="primary-button" :disabled="refreshing || refreshCooldown > 0" @click="refreshCatalog">{{ refreshing ? '正在加载…' : '重新加载' }}</button></section>
        <template v-else>
          <div v-if="catalog.stale || error" class="models-notice warning" role="status"><Info :size="16" /><span>{{ error || '更新暂不可用。' }} 上次更新 {{ dateLabel(catalog.updatedAt) }}</span><button type="button" :disabled="refreshing || refreshCooldown > 0" @click="refreshCatalog">重试</button></div>
          <AllModelsDirectory v-if="platform === 'all'" :catalog="catalog" :theme="theme" @open-platforms="sidebarOpen = true" @copy="copy" @updated="catalog = $event" />
          <template v-else>
          <div class="models-controls">
            <h1 class="models-title">模型广场</h1>
            <button class="models-platform-trigger" type="button" @click="sidebarOpen = true"><SlidersHorizontal :size="16" />{{ platformLabel }}<ChevronDown :size="14" /></button>
            <div class="billing-toggle" aria-label="付费方式"><button type="button" :class="{ active: mode === 'subscription' }" :aria-pressed="mode === 'subscription'" @click="selectMode('subscription')">订阅</button><button type="button" :class="{ active: mode === 'balance' }" :aria-pressed="mode === 'balance'" @click="selectMode('balance')">余额</button></div>
            <label class="model-group-select"><select :value="group?.id || ''" aria-label="使用分组" @change="setQuery({ group: ($event.target as HTMLSelectElement).value })"><option v-if="!groups.length" value="">暂无可用分组</option><option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option></select><ChevronDown :size="14" /></label>
            <AccountPoolSelect :pools="pools" :model-value="selectedPool?.key" @update:model-value="setQuery({ pool: $event })" />
            <label class="models-search"><Search :size="17" /><input v-model="search" aria-label="搜索模型" placeholder="搜索模型 ID…" maxlength="120" /><button v-if="search" type="button" aria-label="清空搜索" @click="search = ''"><X :size="14" /></button></label>
          </div>
          <div class="models-filterbar">
            <div class="model-type-tabs" aria-label="模型类型"><button type="button" :class="{ active: kind === 'all' }" :aria-pressed="kind === 'all'" @click="setQuery({ type: undefined })">全部</button><button v-for="k in kinds" :key="k" type="button" :class="{ active: kind === k }" :aria-pressed="kind === k" @click="setQuery({ type: k })">{{ kindNames[k] }}</button></div>
            <span class="models-result-count">{{ visible.length }} 个模型</span>
            <div v-if="group" class="models-pricing-summary">
              <span class="context-rate">{{ summaryRateLabel }} {{ imageOnly ? imageRate(visible) : `${rate}x` }}</span><span v-if="coefficient && !imageOnly" class="coefficient-badge">折算 {{ formatCoefficient(coefficient, mode) }}</span>
              <details class="pricing-explainer" @keydown.esc="($event.currentTarget as HTMLDetailsElement).open = false"><summary><Info :size="13" />计费说明<ChevronDown :size="12" /></summary><div><p><strong>{{ imageOnly ? '每张实际价格 = 基础价格 × 图片倍率 × 额度成本' : '实际价格 = 计费基准 × 扣费倍率 × 额度成本' }}</strong></p><p>{{ summaryRateLabel }} {{ imageOnly ? imageRate(visible) : `${rate}x` }} · {{ exchangeLabel }}<template v-if="coefficient && !imageOnly"> · 折算倍率 {{ formatCoefficient(coefficient, mode) }}</template></p><p>{{ mode === 'subscription' ? '订阅价格按额度全部使用计算。' : '余额价格按充值兑换比例折算。' }}</p><p v-if="imageOnly">图片按分辨率、按张计费，实际价格为人民币。</p><template v-else><p>实际价格为人民币（CNY），划线官方价格为{{ referenceCurrencyLabel }}。</p><p v-if="models.some(m => hasResolutionPricing(m))">图片使用各模型行列出的图片倍率。</p><p>官方价格更新于 {{ dateLabel(referenceUpdatedAt || null) }}。</p></template></div></details>
            </div>
            <ExportPricesButton :catalog="catalog" :billing="mode" :rows="exportRows" @updated="catalog = $event" @message="exportMessage = $event" />
          </div>
          <p v-if="exportMessage" class="models-export-message" role="status">{{ exportMessage }}</p>
          <p v-if="copyError" role="status" class="form-error">{{ copyError }}</p>
          <section v-if="!visible.length" class="models-empty"><Search :size="28" /><h2>{{ !groups.length ? '当前付费方式暂无可用模型' : '没有找到匹配的模型' }}</h2><button v-if="search || kind !== 'all'" type="button" class="text-button" @click="search = ''; setQuery({ type: undefined })">清除筛选 <ArrowRight :size="15" /></button></section>
          <section v-for="(section, sectionIndex) in sections" :key="section.kind" class="model-section">
            <h2 :class="sectionIndex === 0 ? 'sr-only' : 'model-section-title'">{{ section.name }}</h2>
            <div class="models-table-wrap" role="region" :aria-label="`${section.name}价格表`" tabindex="0"><table class="models-table" :class="{ 'image-pricing-table': section.resolutionPricing }"><thead><tr><th scope="col">模型 ID</th><template v-if="['text','embedding'].includes(section.kind)"><th scope="col" class="price-column"><span class="price-column-title">输入 <small class="column-unit">1M token</small></span><span class="price-column-label">实际价格 / 官方价格</span></th><th scope="col" class="price-column"><span class="price-column-title">输出 <small class="column-unit">1M token</small></span><span class="price-column-label">实际价格 / 官方价格</span></th><th scope="col" class="price-column"><span class="price-column-title">缓存命中 <small class="column-unit">1M token</small></span><span class="price-column-label">实际价格 / 官方价格</span></th><th v-if="showCoefficient" scope="col" class="coefficient-col">折算倍率</th></template><template v-else-if="section.resolutionPricing"><th v-for="size in IMAGE_RESOLUTIONS" :key="size" scope="col" class="price-column"><span class="price-column-title">{{ size.toUpperCase() }} <small class="column-unit">每张</small></span><span class="price-column-label">实际价格</span></th><th v-if="showCoefficient" scope="col" class="coefficient-col">图片倍率</th></template><template v-else><th scope="col" :colspan="showCoefficient ? 4 : 3">计费项目 · 实际价格 / 官方价格</th></template><th scope="col" class="expand-col"><span class="sr-only">计费明细</span></th></tr></thead>
              <tbody v-for="model in section.models" :key="model.id" :class="{ expanded: expanded.has(model.id) }">
                <tr class="model-row"><th scope="row"><div class="model-name-line"><button type="button" class="model-name" :title="model.id" :aria-expanded="expanded.has(model.id)" @click="toggle(model)">{{ model.id }}</button><span v-if="model.customPricing" class="model-tag" title="使用独立计费基准">独立定价</span><button class="model-copy" type="button" :aria-label="`复制 ${model.id}`" @click="copy(model.id)"><Check v-if="copied === model.id" :size="14" /><Copy v-else :size="14" /></button></div></th>
                  <template v-if="['text', 'embedding'].includes(section.kind)"><td><PriceCell :item="mainItem(model,'input')" :billing="mode" /></td><td><PriceCell :item="mainItem(model,'output')" :billing="mode" /></td><td><PriceCell :item="mainItem(model,'cacheRead')" :billing="mode" /></td><td v-if="showCoefficient" class="coefficient-col"><span class="row-coefficient">{{ model.items[0] ? formatCoefficient(model.items[0].coefficient, mode) : '—' }}</span></td></template>
                  <template v-else-if="section.resolutionPricing"><td v-for="size in IMAGE_RESOLUTIONS" :key="size"><PriceCell :item="mainItem(model, `image-${size}`)" precision="cents" /></td><td v-if="showCoefficient" class="coefficient-col"><span class="row-image-rate">{{ imageRate([model]) }}</span></td></template>
                  <td v-else :colspan="showCoefficient ? 4 : 3"><div class="special-prices"><div v-for="item in firstPrices(model)" :key="item.key"><small>{{ item.label }} · {{ formatUnit(item.unit) }}</small><PriceCell :item="item" :billing="mode" /></div><span v-if="!firstPrices(model).length" class="price-unavailable">报价待确认，查看计费明细</span></div></td>
                  <td class="expand-col"><button type="button" class="model-expand" :aria-label="`${expanded.has(model.id) ? '收起' : '展开'} ${model.id} 计费明细`" :aria-expanded="expanded.has(model.id)" @click="toggle(model)"><ChevronDown :size="17" /></button></td>
                </tr>
                <tr v-if="expanded.has(model.id)" class="model-details-row"><td :colspan="showCoefficient ? 6 : 5"><div class="model-details"><header><strong>计费明细</strong><code class="detail-model-id">{{ model.id }}</code><span v-if="model.customPricing" class="model-tag">独立定价</span><button class="detail-copy" type="button" :aria-label="`复制模型 ID ${model.id}`" @click="copy(model.id)"><Copy :size="13" />{{ copied === model.id ? "已复制" : "复制模型 ID" }}</button></header><ImagePriceDetails v-if="hasResolutionPricing(model)" :model="model" :cny-per-credit="group?.cnyPerCredit" /><PriceComparison v-else :model="model" :billing="mode" /><ul v-if="model.notes.length"><li v-for="note in model.notes" :key="note">{{ note }}</li></ul><a v-if="model.officialSource && !hasResolutionPricing(model)" :href="model.officialSource" target="_blank" rel="noopener noreferrer" class="official-link">官方价格来源 <ArrowUpRight :size="13" /></a></div></td></tr>
              </tbody>
            </table></div>
          </section>
          </template>
          <p v-if="platform === 'all' && (copyError || copied)" role="status" class="directory-copy-status">{{ copyError || `${copied} 已复制` }}</p>
          <footer class="models-footer"><span>更新于 {{ dateLabel(catalog.updatedAt) }}<button class="icon-button" type="button" aria-label="刷新模型目录" :disabled="refreshing || refreshCooldown > 0" @click="refreshCatalog"><RefreshCw :size="13" :class="{ spinning: refreshing }" /></button></span><span v-if="refreshMessage || refreshCooldown" role="status" class="model-refresh-feedback">{{ refreshMessage }}<template v-if="refreshCooldown">{{ refreshMessage ? ' · ' : '' }}{{ refreshCooldown }} 秒后可再次刷新</template></span></footer>
        </template>
      </main>
    </div>
    <div class="sr-only" aria-live="polite">{{ copied ? '模型 ID 已复制' : '' }}</div>
  </div>
</template>
