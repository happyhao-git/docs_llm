<script setup lang="ts">
import { computed } from 'vue'
import { Decimal } from 'decimal.js'
import type { CatalogModel } from './types'
import { formatAmount, formatCoefficient } from './presentation'
import PriceCell from './PriceCell.vue'
import './price-comparison.css'

const props = defineProps<{ model: CatalogModel; cnyPerCredit?: string }>()
const rounded = computed(() => props.model.items.some(item => item.final !== null
  && !new Decimal(item.final).eq(new Decimal(item.final).toDecimalPlaces(2, Decimal.ROUND_HALF_UP))))
</script>

<template>
  <div class="image-price-details">
    <div class="comparison-scroll" role="region" aria-label="图片计费明细" tabindex="0">
      <table class="image-calculation-table">
        <thead><tr><th scope="col">分辨率</th><th scope="col">基础价格<small>额度 / 张</small></th><th scope="col">图片倍率</th><th scope="col">额度成本<small>元 / 额度</small></th><th scope="col">实际价格<small>元 / 张</small></th></tr></thead>
        <tbody><tr v-for="item in model.items" :key="item.key">
          <th scope="row">{{ item.label.replace(' 图片', '') }}<small v-if="item.condition">{{ item.condition }}</small></th>
          <td class="image-base-price">{{ item.base === null ? '待确认' : item.base }}</td>
          <td class="image-billing-rate">{{ formatCoefficient(item.rate) }}</td>
          <td>{{ cnyPerCredit ? `¥${formatAmount(cnyPerCredit, true)}` : '—' }}</td>
          <td><PriceCell :item="item" precision="exact" /></td>
        </tr></tbody>
      </table>
    </div>
    <p class="image-price-formula">实际价格 = 基础价格 × 图片倍率 × 额度成本<span v-if="rounded">。列表按分显示，本表保留准确金额。</span></p>
  </div>
</template>
