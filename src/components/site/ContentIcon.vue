<script setup lang="ts">
export type ContentIconKind = 'document' | 'book' | 'code' | 'terminal' | 'image' | 'layers'
withDefaults(defineProps<{ kind?: ContentIconKind; size?: number }>(), { kind: 'document', size: 18 })
</script>

<template>
  <svg class="content-icon" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" :data-icon="kind">
    <template v-if="kind === 'document'">
      <rect x="5" y="3" width="14" height="18" rx="3" fill="currentColor" fill-opacity=".07" stroke="none" />
      <rect x="5" y="3" width="14" height="18" rx="3" />
      <path d="M9 8h6M9 12h6M9 16h3.5" />
    </template>
    <template v-else-if="kind === 'book'">
      <path d="M12 6.5C9.5 4.6 6.2 4.2 3 5v13.5c3.2-.8 6.5-.4 9 1.5V6.5Z" fill="currentColor" fill-opacity=".07" stroke="none" />
      <path d="M12 6.5C9.5 4.6 6.2 4.2 3 5v13.5c3.2-.8 6.5-.4 9 1.5 2.5-1.9 5.8-2.3 9-1.5V5c-3.2-.8-6.5-.4-9 1.5Zm0 0V20M6.5 8.5c.7 0 1.4.1 2 .3M6.5 12c.7 0 1.4.1 2 .3M15.5 8.8c.6-.2 1.3-.3 2-.3M15.5 12.3c.6-.2 1.3-.3 2-.3" />
    </template>
    <template v-else-if="kind === 'code'">
      <rect x="2.5" y="4.5" width="19" height="15" rx="3.5" fill="currentColor" fill-opacity=".06" stroke="none" />
      <path d="m8 8.5-3.5 3.5L8 15.5m8-7 3.5 3.5-3.5 3.5M13.5 6.5l-3 11" />
    </template>
    <template v-else-if="kind === 'terminal'">
      <rect x="3" y="4.5" width="18" height="15" rx="3" fill="currentColor" fill-opacity=".06" stroke="none" />
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <path d="m7.5 9 3 3-3 3M13.5 15H17" />
    </template>
    <template v-else-if="kind === 'image'">
      <rect x="3" y="4" width="18" height="16" rx="3" fill="currentColor" fill-opacity=".06" stroke="none" />
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="8" cy="9" r="1.25" fill="currentColor" stroke="none" />
      <path d="m4 17 5-5 4 4 3-3 4 4" />
    </template>
    <template v-else>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" fill="currentColor" fill-opacity=".08" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </template>
  </svg>
</template>
