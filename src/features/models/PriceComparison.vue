<script setup lang="ts">
import { computed } from 'vue'
import type { BillingMode, CatalogModel } from './types'
import { buildPriceComparison, relativePrice } from './comparison'
import { formatAmount, formatCoefficient, formatUnit } from './presentation'
import PriceCell from './PriceCell.vue'
import './price-comparison.css'

const props = defineProps<{ model: CatalogModel; billing: BillingMode }>()
const comparison = computed(() => buildPriceComparison(props.model.items))
const referenceSymbols = computed(() => [...new Set(props.model.items.map(i => i.officialCurrency === 'CNY' ? '¥' : '$'))].join(' / '))
const cell = (scenario: number, key: string) => comparison.value.columns[scenario]?.items.get(key)
const relative = (scenario: number, key: string) => relativePrice(cell(scenario, key), comparison.value.standard?.items.get(key))
</script>

<template>
  <div class="price-comparison">
    <div class="comparison-legend"><span>实际价格 <b>¥</b> / 官方价格 <s>{{ referenceSymbols }}</s></span><span v-if="comparison.hasLongContext">上下文包含输入及缓存 token</span></div>
    <div v-if="comparison.rows.length" class="comparison-scroll" role="region" aria-label="计费模式价格对比" tabindex="0">
      <table class="comparison-table" :style="{ '--scenario-count': comparison.columns.length }">
        <thead><tr><th scope="col" class="comparison-metric">计费项目</th><th v-for="scenario in comparison.columns" :key="scenario.id" scope="col" :class="['scenario-heading', 'scenario-' + scenario.kind]"><strong>{{ scenario.label }}</strong><small v-if="scenario.context">{{ scenario.context }}</small></th></tr></thead>
        <tbody><tr v-for="metric in comparison.rows" :key="metric.id"><th scope="row" class="comparison-metric"><strong>{{ metric.label }}</strong><small>{{ formatUnit(metric.unit) }}</small></th><td v-for="(scenario, index) in comparison.columns" :key="scenario.id" :class="{ 'standard-price': scenario.kind === 'standard' }"><PriceCell :item="cell(index, metric.id)" :billing="billing" /><small v-if="scenario.kind !== 'standard' && relative(index, metric.id)" class="comparison-ratio" :class="{ higher: relative(index, metric.id)!.direction > 0, lower: relative(index, metric.id)!.direction < 0 }">{{ relative(index, metric.id)!.label }}</small></td></tr></tbody>
      </table>
    </div>
    <p v-else class="price-unavailable">暂无可用报价</p>
    <details v-if="model.items.length" class="calculation-details">
      <summary>计费基准与倍率</summary>
      <div class="calculation-scroll" role="region" aria-label="计费基准与倍率" tabindex="0"><table class="calculation-table"><thead><tr><th scope="col">计费模式</th><th scope="col">项目 / 单位</th><th scope="col">计费基准 / 额度</th><th scope="col">扣费倍率</th><th scope="col">折算倍率</th></tr></thead><tbody><tr v-for="item in model.items" :key="item.key"><td>{{ item.condition || '标准' }}</td><td>{{ item.label }} · {{ formatUnit(item.unit) }}</td><td>{{ item.base === null ? '待确认' : formatAmount(item.base, true) }}</td><td>{{ item.rate }}x</td><td>{{ formatCoefficient(item.coefficient, billing) }}</td></tr></tbody></table></div>
    </details>
  </div>
</template>
