<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'
import type { CatalogPool } from './types'
defineProps<{ pools: CatalogPool[]; modelValue?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <label v-if="pools.length" class="model-group-select account-pool-select">
    <span>账号池</span>
    <select :value="modelValue" aria-label="账号池" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)">
      <option v-for="pool in pools" :key="pool.key" :value="pool.key">{{ pool.name }}</option>
    </select>
    <ChevronDown :size="14" />
  </label>
</template>

<style scoped>
.account-pool-select{display:flex;align-items:center;gap:6px;flex-basis:242px;max-width:280px}
.account-pool-select>span{flex-shrink:0;font-size:11px;color:var(--text-secondary)}
.account-pool-select select{min-width:0}
@media(max-width:800px){
  .models-controls .account-pool-select{grid-column:1 / -1;grid-row:3;max-width:none;width:100%}
  .account-pool-select>span{padding-left:10px}
}
</style>
