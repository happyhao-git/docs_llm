<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { Download, LoaderCircle } from 'lucide-vue-next'
import type { ExportSelection } from '../../../server/models/export-contract'
import type { BillingMode, PublicCatalog } from './types'
import { CatalogChangedError, fetchPricePdf } from './export-pdf'
import { modelCatalog } from './catalog-cache'

const props = defineProps<{ catalog: PublicCatalog; billing: BillingMode; rows: ExportSelection[]; showRelease?: boolean; showPlatform?: boolean }>()
const emit = defineEmits<{ updated: [catalog: PublicCatalog]; message: [message: string] }>()
const busy = ref(false)
let controller: AbortController | undefined, disposed = false
const downloads = new Map<string, ReturnType<typeof setTimeout>>()
async function download() {
  if (busy.value || !props.rows.length) return
  if (props.rows.length > 500) { emit('message', '模型数量过多，请缩小筛选范围后导出。'); return }
  busy.value = true; emit('message', '')
  controller = new AbortController()
  const active = controller, timeout = setTimeout(() => active.abort(), 60_000)
  // Capture the click's selection; later filter edits must not alter this file.
  const rows = props.rows.map(row => ({ ...row }))
  try {
    const result = await fetchPricePdf(props.catalog, props.billing, rows, !!props.showRelease, active.signal, !!props.showPlatform)
    if (disposed) return
    const url = URL.createObjectURL(result.blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = result.filename; document.body.append(anchor); anchor.click(); anchor.remove()
    downloads.set(url, setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url) }, 60_000))
  } catch (error) {
    if (disposed) return
    if (error instanceof CatalogChangedError) {
      try {
        const next = await modelCatalog.load(true)
        if (!disposed) { emit('updated', next); emit('message', '价格表已更新，请核对后重新导出。') }
      } catch { if (!disposed) emit('message', '价格表已变化，列表暂时无法更新，请稍后重试。') }
    } else emit('message', active.signal.aborted ? '导出超时，请重试。' : error instanceof TypeError ? '连接失败，请重试。' : error instanceof Error ? error.message : '导出失败，请重试。')
  } finally { clearTimeout(timeout); if (!disposed) busy.value = false }
}
onBeforeUnmount(() => {
  disposed = true; controller?.abort()
  downloads.forEach((timer, url) => { clearTimeout(timer); URL.revokeObjectURL(url) })
})
</script>

<template>
  <button class="models-export" type="button" :disabled="busy || !rows.length" :aria-busy="busy" aria-label="导出 PDF" title="导出当前价格表" @click="download">
    <LoaderCircle v-if="busy" :size="14" class="spinning" /><Download v-else :size="14" />
    <span>{{ busy ? '正在导出' : '导出 PDF' }}</span>
  </button>
</template>

<style>
.models-export{display:inline-flex;align-items:center;justify-content:center;gap:5px;flex-shrink:0;min-height:28px;border:1px solid var(--border);border-radius:6px;padding:4px 9px;background:var(--surface);color:var(--text-secondary);font-size:11px;line-height:1.5;cursor:pointer;white-space:nowrap}
.models-export:hover:not(:disabled){color:var(--accent);border-color:var(--accent);background:var(--accent-soft)}
.models-export:disabled{opacity:.5;cursor:default}
.models-export-message{margin:0 0 10px;font-size:11px;color:var(--text-secondary);line-height:1.6}
@media(max-width:1100px){.models-export{padding:5px 7px}.models-export span{display:none}}
</style>
