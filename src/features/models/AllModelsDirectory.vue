<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronDown, Copy, Info, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-vue-next'
import type { BillingMode, PublicCatalog } from './types'
import { PLATFORM_NAMES } from './types'
import { directoryRows, directorySorts, sortDirectory, standardItem, type DirectoryRow, type DirectorySort } from './directory'
import { formatCoefficient, formatUnit, hasResolutionPricing, IMAGE_RESOLUTIONS, kindNames } from './presentation'
import PriceCell from './PriceCell.vue'
import PriceComparison from './PriceComparison.vue'
import ImagePriceDetails from './ImagePriceDetails.vue'
import ExportPricesButton from './ExportPricesButton.vue'
import AccountPoolSelect from './AccountPoolSelect.vue'
import { accountPool } from '../../../server/models/account-pools'
import { directoryFilters, directoryPoolCatalog } from './directory-filters'
import './directory.css'

const props = defineProps<{ catalog: PublicCatalog; theme: string }>()
const emit = defineEmits<{ openPlatforms: []; copy: [id: string]; updated: [catalog: PublicCatalog] }>()
const route = useRoute(), router = useRouter()
const mode = computed<BillingMode>(() => route.query.billing === 'balance' ? 'balance' : 'subscription')
const filters = computed(() => directoryFilters(props.catalog, mode.value, route.query))
const vendor = computed(() => filters.value.vendor)
const kind = computed(() => typeof route.query.type === 'string' && kindNames[route.query.type] ? route.query.type : '')
const sort = computed<DirectorySort>(() => directorySorts.some(s => s.value === route.query.sort) ? route.query.sort as DirectorySort : 'platform')
const direction = computed(() => route.query.dir === 'asc' || route.query.dir === 'desc' ? route.query.dir : ['version', 'released'].includes(sort.value) ? 'desc' : 'asc')
const groupFilter = computed(() => filters.value.groupId)
const pools = computed(() => filters.value.pools)
const selectedPool = computed(() => filters.value.selectedPool)
const poolSelections = computed(() => selectedPool.value ? { [vendor.value]: selectedPool.value.key } : {})
const selectedCatalog = computed(() => directoryPoolCatalog(props.catalog, poolSelections.value))
const search = computed({ get: () => String(route.query.q || ''), set: value => query({ q: value || undefined }) })
const selections = ref<Record<string, string>>({}), expanded = ref(new Set<string>()), exportMessage = ref('')
const selectedForMode = computed(() => Object.fromEntries(Object.entries(selections.value).filter(([key]) => key.startsWith(mode.value + ':')).map(([key, value]) => [key.slice(mode.value.length + 1), value])))
const rows = computed(() => directoryRows(selectedCatalog.value, mode.value, selectedForMode.value, groupFilter.value))
const visible = computed(() => sortDirectory(rows.value.filter(r => (!vendor.value || r.model.platform === vendor.value)
  && (!selectedPool.value || !!r.group)
  && (!kind.value || r.model.kind === kind.value) && r.model.id.toLowerCase().includes(search.value.trim().toLowerCase())), sort.value, direction.value, mode.value))
const exportRows = computed(() => visible.value.map(row => ({ platform: row.model.platform, modelId: row.model.id, groupId: row.group?.id ?? null,
  poolKey: mode.value === 'subscription' ? row.group ? accountPool(row.group, row.model.platform, poolSelections.value[row.model.platform])?.key : poolSelections.value[row.model.platform] : undefined })))
const groups = computed(() => filters.value.groups)
const kinds = computed(() => Object.keys(kindNames).filter(k => rows.value.some(r => r.model.kind === k && (!vendor.value || r.model.platform === vendor.value))))
const showRelease = computed(() => sort.value === 'released')
const priceSort = computed(() => !['platform', 'version', 'released', 'name'].includes(sort.value))
const priceSortUnit = computed(() => sort.value.startsWith('image-') ? '元 / 张' : '元 / 1M token')
const directionLabel = computed(() => sort.value === 'platform' ? direction.value === 'asc' ? '平台顺序' : '平台倒序' : ['version', 'released'].includes(sort.value) ? direction.value === 'desc' ? '从新到旧' : '从旧到新' : direction.value === 'asc' ? '升序' : '降序')
const icon = (id: string) => `/platform-icons/${id === 'kimi' && props.theme === 'dark' ? 'kimi-dark' : id}.svg?v=20261104b`
function query(values: Record<string, string | undefined>) { void router.replace({ path: '/models', query: { ...route.query, platform: 'all', ...values } }) }
function billing(value: BillingMode) { expanded.value = new Set(); query({ billing: value, group: undefined, pool: undefined }) }
function chooseVendor(value: string) { query({ vendor: value || undefined, pool: undefined, type: undefined }) }
function chooseGroup(row: DirectoryRow, value: string) {
  selections.value = { ...selections.value, [`${mode.value}:${row.key}`]: value }
}
function toggle(key: string) { const next = new Set(expanded.value); next.has(key) ? next.delete(key) : next.add(key); expanded.value = next }
function chooseSort(value: string) { query({ sort: value, dir: undefined }) }
function reset() {
  expanded.value = new Set(); exportMessage.value = ''
  query({ q: undefined, vendor: undefined, type: undefined, group: undefined, sort: undefined, dir: undefined, pool: undefined })
}
const firstPrices = (row: DirectoryRow) => row.model.items.filter(i => !i.condition && i.final !== null).slice(0, 3)
watch([mode, groupFilter, vendor, selectedPool], () => { expanded.value = new Set() })
watch(() => filters.value.query, normalized => {
  if (Object.entries(normalized).some(([key, value]) => route.query[key] !== value)) query(normalized)
}, { immediate: true })
</script>

<template>
  <div class="all-models-directory">
    <div class="models-controls" :class="{ 'has-account-pools': pools.length > 0 }">
      <h1 class="models-title">模型广场</h1>
      <button class="models-platform-trigger" type="button" @click="emit('openPlatforms')"><SlidersHorizontal :size="16" />全部模型<ChevronDown :size="14" /></button>
      <div class="billing-toggle" aria-label="付费方式"><button type="button" :class="{ active: mode === 'subscription' }" :aria-pressed="mode === 'subscription'" @click="billing('subscription')">订阅</button><button type="button" :class="{ active: mode === 'balance' }" :aria-pressed="mode === 'balance'" @click="billing('balance')">余额</button></div>
      <label class="model-group-select directory-group-select"><select :value="groupFilter" aria-label="使用分组" @change="query({ group: ($event.target as HTMLSelectElement).value || undefined })"><option value="">全部分组</option><option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option></select><ChevronDown :size="14" /></label>
      <label class="model-group-select directory-vendor-select"><span>厂商</span><select :value="vendor" aria-label="模型厂商" @change="chooseVendor(($event.target as HTMLSelectElement).value)"><option value="">全部厂商</option><option v-for="p in filters.vendors" :key="p.id" :value="p.id">{{ p.name }}</option></select><ChevronDown :size="14" /></label>
      <AccountPoolSelect :pools="pools" :model-value="selectedPool?.key" @update:model-value="query({ pool: $event })" />
      <label class="models-search"><Search :size="17" /><input v-model="search" aria-label="搜索模型" placeholder="搜索模型 ID…" maxlength="120" /><button v-if="search" type="button" aria-label="清空搜索" @click="search = ''"><X :size="14" /></button></label>
    </div>
    <div class="directory-filters">
      <label class="directory-select"><select :value="kind" aria-label="模型类型" @change="query({ type: ($event.target as HTMLSelectElement).value || undefined })"><option value="">全部类型</option><option v-for="k in kinds" :key="k" :value="k">{{ kindNames[k] }}</option></select><ChevronDown :size="12" /></label>
      <div class="directory-sort"><label class="directory-select"><select :value="sort" aria-label="排序依据" @change="chooseSort(($event.target as HTMLSelectElement).value)"><option v-for="s in directorySorts" :key="s.value" :value="s.value">{{ s.label }}</option></select><ChevronDown :size="12" /></label><button type="button" class="directory-direction" :title="directionLabel" :aria-label="`排序方向：${directionLabel}`" @click="query({ dir: direction === 'asc' ? 'desc' : 'asc' })"><ArrowDown v-if="direction === 'desc'" :size="14" /><ArrowUp v-else :size="14" /></button></div>
      <button type="button" class="directory-reset" title="重置筛选与排序" @click="reset"><RotateCcw :size="13" />重置</button>
      <span class="directory-count" aria-live="polite">{{ visible.length }} 个模型</span>
      <span v-if="priceSort" class="directory-sort-note">实际价格 · {{ priceSortUnit }}</span>
      <span v-else-if="showRelease" class="directory-sort-note">未知日期排在最后</span>
      <details class="directory-help pricing-explainer"><summary><Info :size="13" />计费说明</summary><div><p>价格按各行所选分组计算，可切换分组查看。</p><p>实际价格为人民币；DeepSeek、GLM、Kimi 官方价格为人民币，其他厂商为美元。</p><p>订阅按额度全部使用计算。价格排序仅比较相同计费单位，暂无报价的模型排在最后。</p></div></details>
      <ExportPricesButton :catalog="catalog" :billing="mode" :rows="exportRows" :show-release="showRelease" show-platform @updated="emit('updated', $event)" @message="exportMessage = $event" />
    </div>
    <p v-if="exportMessage" class="models-export-message" role="status">{{ exportMessage }}</p>
    <section v-if="!visible.length" class="models-empty"><Search :size="28" /><h2>没有找到匹配的模型</h2><button class="text-button" type="button" @click="reset">清除筛选</button></section>
    <div v-else class="models-table-wrap directory-table-wrap" role="region" aria-label="全部模型价格表" tabindex="0">
      <table class="models-table directory-table" :class="{ 'with-release': showRelease }">
        <thead><tr><th scope="col" class="directory-platform-column">平台</th><th scope="col" class="directory-model-column">模型 ID</th><th v-for="metric in [{ key: 'input', name: '输入' }, { key: 'output', name: '输出' }, { key: 'cacheRead', name: '缓存命中' }]" :key="metric.key" scope="col" :aria-sort="sort === metric.key ? direction === 'asc' ? 'ascending' : 'descending' : 'none'"><button type="button" class="directory-column-sort" :aria-label="`按${metric.name}价格排序`" @click="sort === metric.key ? query({ dir: direction === 'asc' ? 'desc' : 'asc' }) : chooseSort(metric.key)"><span class="price-column-title">{{ metric.name }} <small class="column-unit">1M token</small></span><ArrowDown v-if="sort === metric.key && direction === 'desc'" :size="11" /><ArrowUp v-else-if="sort === metric.key" :size="11" /></button><span class="price-column-label">实际价格 / 官方价格</span></th><th scope="col" class="directory-group-column">使用分组</th><th v-if="showRelease" scope="col" class="directory-release-column" :aria-sort="direction === 'asc' ? 'ascending' : 'descending'">发布日期</th><th scope="col" class="expand-col"><span class="sr-only">计费明细</span></th></tr></thead>
        <tbody v-for="(row, rowIndex) in visible" :key="row.key" :data-model-key="row.key" :data-platform="row.model.platform" :class="{ expanded: expanded.has(row.key), 'platform-start': rowIndex > 0 && visible[rowIndex - 1].model.platform !== row.model.platform && ['platform', 'version'].includes(sort) }">
          <tr class="model-row">
            <td class="directory-platform-column"><div class="directory-platform"><img class="platform-icon directory-icon" :data-platform="row.model.platform" :src="icon(row.model.platform)" alt="" aria-hidden="true" width="18" height="18" loading="lazy" /><span>{{ PLATFORM_NAMES[row.model.platform] || row.model.platform }}</span></div></td>
            <th scope="row" class="directory-model-column"><div class="directory-model"><div class="directory-identity"><div class="model-name-line"><button class="model-name" type="button" :title="row.model.id" :aria-expanded="expanded.has(row.key)" @click="toggle(row.key)">{{ row.model.id }}</button><button class="model-copy" type="button" :aria-label="`复制 ${row.model.id}`" @click="emit('copy', row.model.id)"><Copy :size="12" /></button></div><span class="directory-meta">{{ kindNames[row.model.kind] }}</span></div></div></th>

            <td v-if="!row.group" colspan="3"><button class="directory-other-mode" type="button" @click="billing(mode === 'subscription' ? 'balance' : 'subscription')">查看{{ mode === 'subscription' ? '余额' : '订阅' }}价格 <ArrowUpRight :size="12" /></button></td>
            <template v-else-if="['text', 'embedding'].includes(row.model.kind)"><td v-for="metric in ['input', 'output', 'cacheRead']" :key="metric"><PriceCell :item="standardItem(row.model, metric)" :billing="mode" /></td></template>
            <td v-else-if="hasResolutionPricing(row.model)" colspan="3"><div class="directory-image-prices"><div v-for="size in IMAGE_RESOLUTIONS" :key="size"><small>{{ size.toUpperCase() }} / 张</small><PriceCell :item="standardItem(row.model, `image-${size}`)" precision="cents" /></div></div></td>
            <td v-else colspan="3"><div class="special-prices"><div v-for="item in firstPrices(row)" :key="item.key"><small>{{ item.label }} · {{ formatUnit(item.unit) }}</small><PriceCell :item="item" :billing="mode" /></div><span v-if="!firstPrices(row).length" class="price-unavailable">待确认</span></div></td>
            <td class="directory-group-column"><label v-if="row.group && row.groups.length > 1 && !groupFilter" class="directory-row-group"><select :value="row.group.id" :aria-label="`${row.model.id} 使用分组`" @change="chooseGroup(row, ($event.target as HTMLSelectElement).value)"><option v-for="g in row.groups" :key="g.id" :value="g.id">{{ g.name }}</option></select><ChevronDown :size="11" /></label><span v-else-if="row.group" class="directory-group-name" :title="row.group.name">{{ row.group.name }}</span><span v-else class="price-unavailable">{{ mode === 'subscription' ? '暂无订阅' : '暂无余额分组' }}</span><small v-if="row.group && row.model.items[0]" class="directory-row-rate">{{ hasResolutionPricing(row.model) ? `图片倍率 ${formatCoefficient(row.model.items[0].rate)}` : `折算 ${formatCoefficient(row.model.items[0].coefficient, mode)}` }}</small></td>
            <td v-if="showRelease" class="directory-release-column"><time v-if="row.model.releasedAt" :datetime="row.model.releasedAt">{{ row.model.releasedAt }}</time><span v-else class="price-unavailable">—</span></td>
            <td class="expand-col"><button class="model-expand" type="button" :aria-label="`${expanded.has(row.key) ? '收起' : '展开'} ${row.model.id} 计费明细`" :aria-expanded="expanded.has(row.key)" @click="toggle(row.key)"><ChevronDown :size="16" /></button></td>
          </tr>
          <tr v-if="expanded.has(row.key)" class="model-details-row"><td :colspan="showRelease ? 8 : 7"><div class="model-details"><header><strong>计费明细</strong><code class="detail-model-id">{{ row.model.id }}</code><span v-if="row.group">{{ row.group.name }}</span><button class="detail-copy" type="button" :aria-label="`复制模型 ID ${row.model.id}`" @click="emit('copy', row.model.id)"><Copy :size="13" />复制模型 ID</button></header><template v-if="row.group"><ImagePriceDetails v-if="hasResolutionPricing(row.model)" :model="row.model" :cny-per-credit="row.group.cnyPerCredit" /><PriceComparison v-else :model="row.model" :billing="mode" /><ul v-if="row.model.notes.length"><li v-for="note in row.model.notes" :key="note">{{ note }}</li></ul></template><p v-else class="price-unavailable">当前付费方式暂无可用分组。</p><div class="directory-source-links"><a v-if="row.model.officialSource" :href="row.model.officialSource" target="_blank" rel="noopener noreferrer" class="official-link">官方价格来源 <ArrowUpRight :size="12" /></a><a v-if="row.model.releasedAt && row.model.releaseSource" :href="row.model.releaseSource" target="_blank" rel="noopener noreferrer" class="official-link">发布于 {{ row.model.releasedAt }} <ArrowUpRight :size="12" /></a></div></div></td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
