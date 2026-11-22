import { Check, Copy, Link, X, createElement } from 'lucide'

async function copyText(text: string) {
  if (!text) return false
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true } catch { /* Fall back for restricted browsers. */ }
  }
  const focused = document.activeElement as HTMLElement | null
  const input = document.createElement('textarea')
  input.value = text; input.setAttribute('readonly', ''); input.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
  document.body.append(input); input.select()
  try { return document.execCommand('copy') } finally { input.remove(); focused?.focus() }
}

export function initializeDocInteractions(root: HTMLElement, onImage?: (source: string, alt: string) => void) {
  const timers: number[] = []
  const imageListeners: Array<() => void> = []
  const icons = { copy: Copy, check: Check, link: Link, x: X }
  const renderIcons = (scope: HTMLElement = root) => {
    scope.querySelectorAll<HTMLElement>('i[data-lucide]').forEach((placeholder) => {
      const icon = icons[placeholder.dataset.lucide as keyof typeof icons]
      if (icon) placeholder.replaceWith(createElement(icon, { width: 15, height: 15, 'stroke-width': 2, 'aria-hidden': 'true' }))
    })
  }
  root.querySelectorAll<HTMLElement>('h2[id],h3[id]').forEach((heading) => {
    if (heading.querySelector('[data-heading-copy]')) return
    const button = document.createElement('button'); button.type = 'button'; button.className = 'heading-copy'
    button.dataset.headingCopy = heading.id; button.setAttribute('aria-label', `复制“${heading.textContent}”的链接`)
    button.innerHTML = '<i data-lucide="link"></i>'; heading.append(button)
  })
  root.querySelectorAll<HTMLImageElement>('.doc-image').forEach((image) => {
    if (onImage) { image.tabIndex = 0; image.setAttribute('role', 'button'); image.setAttribute('aria-label', `放大查看：${image.alt || '教程图片'}`) }
    const onError = () => {
      if (image.parentElement?.querySelector('.image-error')) return
      image.classList.add('failed')
      const message = document.createElement('span'); message.className = 'image-error'; message.setAttribute('role', 'status')
      message.textContent = `图片暂时无法加载${image.alt ? `：${image.alt}` : ''}。`
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重新加载'
      retry.onclick = () => { message.remove(); image.classList.remove('failed'); const source = image.src; image.removeAttribute('src'); image.src = source }
      message.append(retry); image.after(message)
    }
    image.addEventListener('error', onError)
    if (image.complete && image.naturalWidth === 0) onError()
    imageListeners.push(() => image.removeEventListener('error', onError))
  })
  renderIcons()
  const feedback = (button: HTMLButtonElement, ok: boolean, label: string, icon = 'copy') => {
    if (!root.contains(button)) return
    button.innerHTML = `<i data-lucide="${ok ? 'check' : 'x'}"></i>${button.classList.contains('code-copy') ? `<span>${ok ? '已复制' : '复制失败'}</span>` : ''}`
    button.setAttribute('aria-label', ok ? '已复制' : '复制失败，请手动复制'); button.classList.toggle('copied', ok); renderIcons(button)
    timers.push(window.setTimeout(() => {
      button.innerHTML = `<i data-lucide="${icon}"></i>${button.classList.contains('code-copy') ? '<span>复制</span>' : ''}`
      button.setAttribute('aria-label', label); button.classList.remove('copied'); renderIcons(button)
    }, 1800))
  }
  const activateTab = (button: HTMLButtonElement) => {
    const tabs = button.closest('.doc-tabs')
    tabs?.querySelectorAll<HTMLButtonElement>('.doc-tab-button').forEach((item) => {
      const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1
    })
    tabs?.querySelectorAll('.doc-tab-panel').forEach((panel) => panel.classList.toggle('active', panel.id === button.dataset.tabTarget))
  }
  const onClick = async (event: MouseEvent) => {
    const target = event.target as HTMLElement
    const copy = target.closest<HTMLButtonElement>('[data-copy-code]')
    if (copy) { const text = copy.closest('.code-block')?.querySelector('pre > code')?.textContent ?? ''; feedback(copy, await copyText(text), '复制代码'); return }
    const heading = target.closest<HTMLButtonElement>('[data-heading-copy]')
    if (heading) { const url = new URL(window.location.href); url.hash = heading.dataset.headingCopy ?? ''; feedback(heading, await copyText(url.href), '复制章节链接', 'link'); return }
    const expand = target.closest<HTMLButtonElement>('[data-code-toggle]')
    if (expand) { const block = expand.closest('.code-block'); const collapsed = block?.classList.toggle('is-collapsed'); expand.setAttribute('aria-expanded', String(!collapsed)); expand.textContent = collapsed ? '展开完整内容' : '收起内容'; return }
    const tab = target.closest<HTMLButtonElement>('[data-tab-target]')
    if (tab) { activateTab(tab); return }
    const image = target.closest<HTMLImageElement>('.doc-image')
    if (image && onImage && image.naturalWidth > 0) { onImage(image.currentSrc || image.src, image.alt); return }
    const anchor = target.closest<HTMLAnchorElement>('a[href^="#"]')
    if (anchor) {
      let id = ''; try { id = decodeURIComponent(anchor.hash.slice(1)) } catch { return }
      const destination = document.getElementById(id)
      if (destination) {
        event.preventDefault()
        let parent = destination.parentElement
        while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement }
        destination.scrollIntoView({ behavior: 'smooth', block: 'start' }); history.replaceState(history.state, '', `#${encodeURIComponent(id)}`)
      }
    }
  }
  const onKeydown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement
    if (target.matches('.doc-image') && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); target.click() }
    const tab = target.closest<HTMLButtonElement>('[data-tab-target]')
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(tab.closest('.doc-tabs')?.querySelectorAll<HTMLButtonElement>('.doc-tab-button') ?? [])
    const index = buttons.indexOf(tab)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    event.preventDefault(); activateTab(buttons[next]); buttons[next].focus()
  }
  root.addEventListener('click', onClick); root.addEventListener('keydown', onKeydown)
  return () => { root.removeEventListener('click', onClick); root.removeEventListener('keydown', onKeydown); timers.forEach(clearTimeout); imageListeners.forEach((cleanup) => cleanup()) }
}
