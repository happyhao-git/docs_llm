<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { ArrowLeft, ExternalLink, RefreshCw, Save, Search, Check, Info } from 'lucide-vue-next'
import { api, ApiError, jsonBody } from '@/lib/api'
import { dateLabel } from './presentation'
import { modelCatalog } from './catalog-cache'
import { PLATFORM_NAMES, type PlazaAdmin, type PlazaSettings } from './types'
import './models.css'
const router = useRouter(), data = ref<PlazaAdmin | null>(null), draft = ref<PlazaSettings | null>(null)
const loading = ref(true), busy = ref(false), message = ref(''), error = ref(''), search = ref('')
const dirty = computed(() => !!data.value && JSON.stringify(draft.value) !== JSON.stringify(data.value.settings))
const inventory = computed(() => new Map(data.value?.inventory.map(g => [g.id, g])))
const rows = computed(() => draft.value?.groups.filter(g => { const source = inventory.value.get(g.id); return source && `${source.name} ${g.name} ${source.platform}`.toLowerCase().includes(search.value.toLowerCase()) }) || [])
function setData(next: PlazaAdmin) { data.value = next; draft.value = structuredClone(next.settings) }
async function run(action: 'load' | 'save' | 'sync') {
  busy.value = true; error.value = ''; message.value = ''
  try {
    const payload = draft.value ? { ...draft.value, exchange: Object.fromEntries(Object.entries(draft.value.exchange).map(([k, v]) => [k, String(v)])) } : null
    const next = action === 'save' ? await api<PlazaAdmin>('/api/admin/models/settings', { method: 'PUT', body: jsonBody(payload) }) : action === 'sync' ? await api<PlazaAdmin>('/api/admin/models/sync', { method: 'POST' }) : await api<PlazaAdmin>('/api/admin/models')
    setData(next)
    if (action !== 'load') modelCatalog.invalidate()
    if (action !== 'load') message.value = action === 'save' ? '配置已保存，公开页面立即生效。' : next.status.error ? '' : '目录同步完成。'
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) await router.replace('/admin/login?redirect=/admin/models')
    else error.value = e instanceof Error ? e.message : '操作失败，请重试'
  } finally { busy.value = false; loading.value = false }
}
onBeforeRouteLeave(() => !dirty.value || window.confirm('有未保存的模型配置，确定离开吗？'))
onMounted(() => { void run('load') })
</script>
<template>
  <div class="model-admin">
    <header class="model-admin-header"><RouterLink to="/admin"><ArrowLeft :size="17" /> 文档管理</RouterLink><strong>模型广场管理</strong><RouterLink to="/models" target="_blank">查看模型广场 <ExternalLink :size="15" /></RouterLink></header>
    <main class="model-admin-main">
      <div class="model-admin-title"><div><h1>目录与价格配置</h1></div><button class="primary-button" type="button" :disabled="busy || !dirty || data?.status.syncing" @click="run('save')"><Save :size="16" />保存配置</button></div>
      <p v-if="loading" role="status">正在读取配置…</p>
      <p v-if="error" role="alert" class="models-notice warning">{{ error }}<button type="button" @click="run('load')">重试</button></p>
      <p v-if="message" role="status" class="models-notice success"><Check :size="17" />{{ message }}</p>
      <template v-if="data && draft">
        <section class="model-admin-panel"><div class="admin-panel-title"><h2>数据同步</h2><button class="secondary-button" type="button" :disabled="busy || dirty || data.status.syncing" @click="run('sync')"><RefreshCw :size="15" :class="{ spinning: busy }" />{{ data.status.syncing ? '同步进行中' : '立即同步' }}</button></div><div class="admin-sync-info"><span>最近成功<strong>{{ dateLabel(data.status.lastSuccessAt) }}</strong></span><span>最近尝试<strong>{{ dateLabel(data.status.lastAttemptAt) }}</strong></span><span>同步方式<strong>每 {{ data.status.syncIntervalMinutes }} 分钟 · 独立只读</strong></span><span>源分组<strong>{{ data.inventory.length }} 个</strong></span></div><p v-if="data.status.error" class="form-error">{{ data.status.error }}</p><p v-if="dirty" class="admin-hint">请先保存配置，再执行同步。</p><details v-if="data.status.warnings.length"><summary>查看 {{ data.status.warnings.length }} 条数据提示</summary><ul><li v-for="warning in data.status.warnings" :key="warning">{{ warning }}</li></ul></details></section>
        <section class="model-admin-panel"><div class="admin-panel-title"><h2>额度兑换成本</h2><span>人民币 / 每额度</span></div><div class="admin-exchange-grid"><label><span>余额</span><div><span>¥</span><input v-model="draft.exchange.balance" type="number" min="0.000001" max="1000" step="0.000001" aria-label="余额每额度人民币成本" /></div><small>默认 ¥1 兑换 5 额度 → 0.20</small></label><label><span>OpenAI 独立订阅</span><div><span>¥</span><input v-model="draft.exchange.openaiSubscription" type="number" min="0.000001" max="1000" step="0.000001" aria-label="OpenAI订阅每额度人民币成本" /></div><small>默认 ¥2 购买 100 额度 → 0.02</small></label><label><span>其他订阅与一卡通</span><div><span>¥</span><input v-model="draft.exchange.otherSubscription" type="number" min="0.000001" max="1000" step="0.000001" aria-label="其他订阅每额度人民币成本" /></div><small>默认 ¥3 购买 100 额度 → 0.03</small></label></div><p class="admin-hint"><Info :size="14" />仅调整人民币成本换算，不修改扣费倍率或模型价格。</p></section>
        <section class="model-admin-panel admin-groups-panel"><div class="admin-panel-title"><div><h2>公开分组</h2><p>新同步的分组默认隐藏；支持范围与计费完全相同的订阅档位自动合并。</p></div><label class="models-search"><Search :size="16" /><input v-model="search" placeholder="筛选分组…" aria-label="筛选后台分组" /></label></div><div class="admin-table-scroll"><table class="admin-groups-table"><thead><tr><th>公开</th><th>来源分组</th><th>展示名称</th><th>排序</th><th>优先选择</th></tr></thead><tbody><tr v-for="g in rows" :key="g.id"><td><input v-model="g.visible" type="checkbox" :aria-label="`公开 ${inventory.get(g.id)?.name}`" /></td><td><strong>{{ inventory.get(g.id)?.name }}</strong><small>{{ PLATFORM_NAMES[inventory.get(g.id)?.platform || ''] || inventory.get(g.id)?.platform }} · {{ inventory.get(g.id)?.mode === 'subscription' ? '订阅' : '余额' }} · {{ inventory.get(g.id)?.rate }}x · {{ inventory.get(g.id)?.modelCount }} 模型</small></td><td><input v-model="g.name" :aria-label="`分组 ${g.id} 展示名称`" maxlength="120" placeholder="留空使用默认名称" /></td><td><input v-model.number="g.order" :aria-label="`分组 ${g.id} 排序`" type="number" min="0" max="100000" /></td><td><input v-model="g.isDefault" :aria-label="`优先选择分组 ${g.id}`" type="checkbox" /></td></tr></tbody></table></div><p v-if="!rows.length" class="models-empty">{{ data.inventory.length ? '没有匹配的分组' : '首次同步成功后，这里会显示实际分组。' }}</p></section>
      </template>
    </main>
  </div>
</template>
