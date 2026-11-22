<script setup lang="ts">
import type { BillingMode, PriceItem } from './types'
import { formatPriceAmount, formatAmount, type PricePrecision } from './presentation'
defineProps<{ item?: PriceItem; billing?: BillingMode; precision?: PricePrecision }>()
</script>
<template>
  <div class="model-price" :class="{ unknown: item?.final == null }">
    <strong v-if="item?.final != null" title="实际价格（CNY）"><span class="sr-only">实际价格 </span><span class="currency">¥</span>{{ formatPriceAmount(item, billing, precision) }}</strong>
    <span v-else class="price-unavailable">{{ item ? '待确认' : '—' }}</span>
    <template v-if="item?.official != null"><span class="price-divider" aria-hidden="true">/</span><s class="price-official" :title="`官方价格（${item.officialCurrency || 'USD'}）`"><span class="sr-only">官方价格 </span>{{ item.officialCurrency === 'CNY' ? '¥' : '$' }}{{ formatAmount(item.official, true) }}</s></template>
  </div>
</template>
