<script setup lang="ts">
import { onMounted } from 'vue'
import { ExternalLink, Moon, Sun } from 'lucide-vue-next'
import { useSite } from './use-site'
import { loadModelsView } from '@/route-views'
import { modelCatalog } from '@/features/models/catalog-cache'
import { BRAND_ICON_URL } from '@/lib/brand'
import { MODEL_PLAZA_ENTRY } from '@/lib/model-entry'
const props = defineProps<{ active: 'docs' | 'models'; consoleUrl?: string; progress?: number }>()
const { settings, theme, initializeTheme, loadSettings, applyTheme } = useSite()
function prefetchModels() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  if (props.active === 'models' || connection?.saveData || ['slow-2g', '2g', '3g'].includes(connection?.effectiveType || '')) return
  // Warm only the intended public page and the site's existing snapshot.
  void Promise.all([loadModelsView(), modelCatalog.load()]).catch(() => undefined)
}
onMounted(() => { initializeTheme(); void loadSettings().catch(() => undefined) })
</script>
<template>
  <header class="docs-header site-header">
    <slot name="leading" />
    <RouterLink class="brand" to="/" aria-label="文档首页"><img class="brand-mark" :src="BRAND_ICON_URL" alt="" width="34" height="34" /><span class="brand-wordmark">Link<span>API</span></span></RouterLink>
    <nav class="site-nav" aria-label="站点导航">
      <RouterLink to="/" :class="{ selected: active === 'docs' }" :aria-current="active === 'docs' ? 'page' : undefined">使用文档</RouterLink>
      <RouterLink :to="MODEL_PLAZA_ENTRY" :class="{ selected: active === 'models' }" :aria-current="active === 'models' ? 'page' : undefined" @pointerenter="prefetchModels" @focus="prefetchModels">模型广场</RouterLink>
    </nav>
    <div class="header-actions">
      <slot name="actions" />
      <button class="icon-button site-theme" type="button" :aria-label="theme === 'light' ? '切换到深色模式' : '切换到浅色模式'" @click="applyTheme(theme === 'light' ? 'dark' : 'light')"><Moon v-if="theme === 'light'" :size="18" /><Sun v-else :size="18" /></button>
      <a v-if="consoleUrl || settings?.consoleUrl" class="console-link" :href="consoleUrl || settings?.consoleUrl" target="_blank" rel="noopener noreferrer" aria-label="进入控制台（新窗口）"><span>进入控制台</span><ExternalLink :size="14" /></a>
    </div>
    <div v-if="progress !== undefined" class="reading-progress" :style="{ transform: `scaleX(${progress / 100})` }" aria-hidden="true" />
  </header>
</template>
