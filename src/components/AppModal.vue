<script setup lang="ts">
import { ref, toRef, useId } from 'vue'
import { useDialog } from '@/lib/use-dialog'
import { X } from 'lucide-vue-next'

const props = defineProps<{
  open: boolean
  title: string
  width?: 'small' | 'medium' | 'large'
}>()

const emit = defineEmits<{ close: [] }>()
const modalRoot = ref<HTMLElement | null>(null)
const titleId = useId()
useDialog(toRef(props, 'open'), modalRoot, () => emit('close'))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @mousedown.self="emit('close')">
      <section ref="modalRoot" tabindex="-1" :aria-labelledby="titleId" class="app-modal" :class="`modal-${width || 'medium'}`" role="dialog" aria-modal="true">
        <header class="modal-header">
          <h2 :id="titleId">{{ title }}</h2>
          <button class="icon-button" type="button" aria-label="关闭" @click="emit('close')"><X :size="18" /></button>
        </header>
        <div class="modal-body"><slot /></div>
        <footer v-if="$slots.footer" class="modal-footer"><slot name="footer" /></footer>
      </section>
    </div>
  </Teleport>
</template>
