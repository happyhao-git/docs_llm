import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue'
let locks = 0
let previousOverflow = ''

export function useDialog(open: Ref<boolean>, root: Ref<HTMLElement | null>, close: () => void) {
  let previousFocus: HTMLElement | null = null
  let locked = false
  const release = () => {
    if (!locked) return
    locked = false
    locks -= 1
    if (!locks) document.body.style.overflow = previousOverflow
    window.removeEventListener('keydown', onKeydown)
  }
  const focusable = () => Array.from(root.value?.querySelectorAll<HTMLElement>(
    'a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]'
  ) ?? []).filter((el) => el.getClientRects().length > 0)
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return }
    if (event.key !== 'Tab') return
    const elements = focusable()
    if (!elements.length) { event.preventDefault(); root.value?.focus(); return }
    const first = elements[0], last = elements[elements.length - 1]
    if (event.shiftKey && (document.activeElement === first || !root.value?.contains(document.activeElement))) {
      event.preventDefault(); last.focus()
    } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  watch(open, async (value) => {
    if (!value) { release(); if (previousFocus?.isConnected) previousFocus.focus(); return }
    previousFocus = document.activeElement as HTMLElement
    if (!locks) previousOverflow = document.body.style.overflow
    locks += 1; locked = true
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeydown)
    await nextTick()
    if (!open.value) return
    const preferred = root.value?.querySelector<HTMLElement>('[data-autofocus]')
    ;(preferred ?? focusable()[0] ?? root.value)?.focus()
  }, { immediate: true })
  onBeforeUnmount(release)
}
