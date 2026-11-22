<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowUp, ArrowLeft, ArrowRight, ChevronRight, ChevronDown, Clock3, Menu, Search, X, List } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import SiteHeader from '@/components/site/SiteHeader.vue'
import ContentIcon, { type ContentIconKind } from '@/components/site/ContentIcon.vue'
import { BRAND_ICON_URL } from '@/lib/brand'
import { initializeDocInteractions } from '@/lib/docs-interactions'
import { useDialog } from '@/lib/use-dialog'
import { DocumentCache, type DocumentResponse } from '@/lib/document-cache'
import type { NavigationSite, DocumentDetail, SearchResult } from '@/types'
import 'highlight.js/styles/github-dark.css'

const route = useRoute(), router = useRouter()
const site = ref<NavigationSite | null>(null)
const documentDetail = ref<DocumentDetail | null>(null)
const loading = ref(true), articleLoading = ref(false), loadError = ref(''), notFound = ref(false)
const sidebarOpen = ref(false), searchOpen = ref(false), outlineOpen = ref(false)
const sidebarRoot = ref<HTMLElement | null>(null), searchRoot = ref<HTMLElement | null>(null), lightboxRoot = ref<HTMLElement | null>(null)
const searchQuery = ref(''), searchResults = ref<SearchResult[]>([]), searching = ref(false), searchError = ref(''), searchSelection = ref(0)
const lightbox = ref<{ source: string; alt: string } | null>(null)
const lightboxOpen = computed(() => Boolean(lightbox.value))
const contentRoot = ref<HTMLElement | null>(null)
const activeHeading = ref(''), readingProgress = ref(0), showBackToTop = ref(false)
const isHome = computed(() => route.name === 'docs-home')
const slug = computed(() => typeof route.params.slug === 'string' ? route.params.slug : '')
const allDocuments = computed(() => site.value?.groups.flatMap((group) => group.documents) ?? [])
const currentGroup = computed(() => site.value?.groups.find((group) => group.documents.some((doc) => doc.slug === slug.value)))
const currentIndex = computed(() => allDocuments.value.findIndex((doc) => doc.slug === slug.value))
const previousDocument = computed(() => allDocuments.value[currentIndex.value - 1])
const nextDocument = computed(() => allDocuments.value[currentIndex.value + 1])
const outline = computed(() => documentDetail.value?.outline ?? [])
const expandedSidebarGroups = ref(new Set<number>())
const visibleResults = computed<SearchResult[]>(() => searchQuery.value.trim() ? searchResults.value : allDocuments.value.slice(0, 8).map((doc) => ({ slug: doc.slug, title: doc.title, snippet: doc.summary, anchor: '', heading: '' })))
let cleanupInteractions: (() => void) | undefined
const articleCache = new DocumentCache()
let searchController: AbortController | undefined
let navigationRequest: Promise<void> | undefined
let prefetchTimer: ReturnType<typeof setTimeout> | undefined
let prefetchIdle: number | undefined
let contentObserver: ResizeObserver | undefined
let measurementFrame = 0
let headingPositions: Array<{ id: string; top: number }> = []
let maxScroll = 0
let disposed = false
let searchTimer: ReturnType<typeof setTimeout> | undefined
let scrollFrame = 0
let navigationGeneration = 0
const dateLabel = (value: string) => new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
const groupIcon = (anchor: string): ContentIconKind => anchor.includes('codex') ? 'code' : anchor.includes('claude') ? 'terminal' : anchor.includes('image') ? 'image' : 'layers'

useDialog(sidebarOpen, sidebarRoot, () => { sidebarOpen.value = false })
useDialog(searchOpen, searchRoot, () => { searchOpen.value = false })
useDialog(lightboxOpen, lightboxRoot, () => { lightbox.value = null })

function windowScrollTop() { window.scrollTo({ top: 0, behavior: 'smooth' }) }
function openSearch() { sidebarOpen.value = false; searchOpen.value = true }
function closeNavigation() { sidebarOpen.value = false; outlineOpen.value = false }
function toggleSidebarGroup(groupId: number) {
  const next = new Set(expandedSidebarGroups.value)
  if (next.has(groupId)) next.delete(groupId)
  else next.add(groupId)
  expandedSidebarGroups.value = next
}
function decodeHash(hash: string) { try { return decodeURIComponent(hash.replace(/^#/, '')) } catch { return '' } }
function scrollToAnchor() {
  const id = decodeHash(route.hash)
  if (!id) { window.scrollTo({ top: 0, behavior: 'instant' }); return }
  const target = document.getElementById(id)
  if (!target) return
  let parent: HTMLElement | null = target.parentElement
  while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement }
  target.scrollIntoView({ block: 'start', behavior: 'instant' })
}
function initializeContent() {
  cleanupInteractions?.()
  if (contentRoot.value && documentDetail.value) cleanupInteractions = initializeDocInteractions(contentRoot.value, (source, alt) => { lightbox.value = { source, alt } })
  activeHeading.value = outline.value[0]?.id ?? ''
  readingProgress.value = 0
  measureContent()
  scrollToAnchor()
  schedulePrefetch()
}
function loadNavigation() {
  if (navigationRequest) return navigationRequest
  navigationRequest = fetch('/api/public/navigation')
    .then(async response => {
      if (!response.ok) throw new Error('暂时无法加载文档，请稍后重试。')
      const next: NavigationSite = await response.json()
      if (disposed) return
      site.value = next
      articleCache.setPublication(next.publication?.id ?? null)
      if (next.settings.accentColor) document.documentElement.style.setProperty('--accent', next.settings.accentColor)
    }).finally(() => { navigationRequest = undefined })
  return navigationRequest
}
async function revalidateNavigation() {
  const version = site.value?.publication?.id
  try {
    await loadNavigation()
    if (!disposed && version !== site.value?.publication?.id) await loadArticle()
  } catch { /* Keep the current article readable when background revalidation fails. */ }
}
function canPrefetch() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  return !disposed && !connection?.saveData && !['slow-2g', '2g'].includes(connection?.effectiveType ?? '')
}
function prefetchDocument(target: string) {
  if (!target || !canPrefetch()) return
  void articleCache.load(target).then(payload => {
    if (!disposed && payload.publication?.id !== site.value?.publication?.id) void revalidateNavigation()
  }).catch(() => { /* A speculative failure must not interrupt reading or prevent a retry. */ })
}
function cancelPrefetch() {
  clearTimeout(prefetchTimer)
  if (prefetchIdle !== undefined) window.cancelIdleCallback(prefetchIdle)
  prefetchIdle = undefined
}
function schedulePrefetch() {
  cancelPrefetch()
  if (!canPrefetch()) return
  const targets = isHome.value ? allDocuments.value.slice(0, 2) : [previousDocument.value, nextDocument.value].filter(Boolean)
  const queue = () => { prefetchTimer = setTimeout(() => targets.forEach(doc => doc && prefetchDocument(doc.slug)), 150) }
  if (window.requestIdleCallback) prefetchIdle = window.requestIdleCallback(queue, { timeout: 1000 })
  else queue()
}
type InitialArticle = Promise<{ payload: DocumentResponse } | { error: unknown }>
async function loadArticle(initial?: InitialArticle) {
  const generation = ++navigationGeneration
  const target = slug.value
  cancelPrefetch()
  notFound.value = false; loadError.value = ''; outlineOpen.value = false
  if (isHome.value) { documentDetail.value = null; articleLoading.value = false; setPageMeta(); await nextTick(); initializeContent(); return }
  const cached = articleCache.peek(target)
  // Cached articles replace each other in the same render, with no skeleton flash.
  documentDetail.value = cached?.document ?? null
  articleLoading.value = !cached
  try {
    const first = initial ? await initial : null
    if (first && 'error' in first) throw first.error
    let payload = first && 'payload' in first ? first.payload : cached ?? await articleCache.load(target)
    if (disposed || generation !== navigationGeneration) return
    if (payload.publication?.id !== site.value?.publication?.id) await loadNavigation()
    if (disposed || generation !== navigationGeneration) return
    if (payload.publication?.id !== site.value?.publication?.id) {
      payload = await articleCache.load(target)
      if (disposed || generation !== navigationGeneration) return
      if (payload.publication?.id !== site.value?.publication?.id) throw new Error('文档刚刚更新，请重新加载。')
    }
    documentDetail.value = payload.document ?? null
    notFound.value = !payload.document
  } catch (error) {
    if (disposed || generation !== navigationGeneration) return
    loadError.value = error instanceof Error ? error.message : '加载失败'
  } finally {
    if (!disposed && generation === navigationGeneration) {
      articleLoading.value = false; setPageMeta(); await nextTick(); initializeContent()
    }
  }
}
function setPageMeta() {
  const title = isHome.value ? 'LinkAPI 开发者文档' : documentDetail.value?.title ?? (notFound.value ? '未找到教程' : '文档加载')
  document.title = isHome.value ? title : `${title} | LinkAPI 文档`
  const description = documentDetail.value?.summary || 'LinkAPI 接入文档、安装教程与配置说明。'
  document.querySelector('meta[name="description"]')?.setAttribute('content', description)
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', document.title)
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', description)
}
async function loadSite() {
  loading.value = true; loadError.value = ''
  const initialSlug = slug.value
  // The URL already identifies the article; do not wait for navigation to request it.
  const initial: InitialArticle | undefined = initialSlug ? articleCache.load(initialSlug)
    .then(payload => ({ payload }), error => ({ error })) : undefined
  try {
    await loadNavigation()
    if (isHome.value && route.hash) {
      const hash = decodeHash(route.hash)
      const legacy = allDocuments.value.find((doc) => hash === doc.slug || hash.startsWith(`${doc.slug}--`))
      if (legacy) await router.replace({ name: 'docs-document', params: { slug: legacy.slug }, hash: hash === legacy.slug ? '' : route.hash })
    }
    loading.value = false
    await loadArticle(initialSlug === slug.value ? initial : undefined)
  } catch (error) { loadError.value = error instanceof Error ? error.message : '加载失败'; loading.value = false }
}
watch(() => route.params.slug, () => {
  closeNavigation()
  if (!loading.value && site.value) { void loadArticle(); void revalidateNavigation() }
})
watch([slug, currentGroup], ([currentSlug, group]) => {
  if (!currentSlug || !group) {
    expandedSidebarGroups.value = new Set()
    return
  }
  const next = new Set(expandedSidebarGroups.value)
  next.add(group.id)
  expandedSidebarGroups.value = next
}, { immediate: true })
watch(() => route.hash, async () => { outlineOpen.value = false; await nextTick(); scrollToAnchor() })
watch([searchQuery, searchOpen], () => {
  clearTimeout(searchTimer); searchController?.abort(); searchSelection.value = 0; searchError.value = ''
  if (!searchOpen.value || !searchQuery.value.trim()) { searching.value = false; searchResults.value = []; return }
  searching.value = true
  searchTimer = setTimeout(async () => {
    const controller = new AbortController(); searchController = controller
    try {
      const response = await fetch(`/api/public/search?q=${encodeURIComponent(searchQuery.value.trim())}`, { signal: controller.signal })
      if (!response.ok) throw new Error('搜索暂时不可用，请稍后重试。')
      const data = await response.json()
      if (!controller.signal.aborted) searchResults.value = data.results
    } catch (error) { if (!controller.signal.aborted) searchError.value = error instanceof Error ? error.message : '搜索失败' }
    finally { if (!controller.signal.aborted) searching.value = false }
  }, 220)
})
function highlight(text: string) {
  const terms = searchQuery.value.trim().split(/\s+/).filter(Boolean).map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!terms.length) return [{ text, match: false }]
  const regex = new RegExp(`(${terms.join('|')})`, 'gi')
  return text.split(regex).filter(Boolean).map((part) => ({ text: part, match: terms.some((term) => new RegExp(`^${term}$`, 'i').test(part)) }))
}
function selectResult(result: SearchResult) {
  searchOpen.value = false; searchQuery.value = ''
  void router.push({ name: 'docs-document', params: { slug: result.slug }, hash: result.anchor ? `#${result.anchor}` : '' })
}
function searchKeys(event: KeyboardEvent) {
  const length = visibleResults.value.length
  if (!length || searching.value) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); searchSelection.value = (searchSelection.value + (event.key === 'ArrowDown' ? 1 : -1) + length) % length
    document.getElementById(`search-result-${searchSelection.value}`)?.scrollIntoView({ block: 'nearest' })
  }
  if (event.key === 'Enter') { event.preventDefault(); selectResult(visibleResults.value[searchSelection.value]) }
}
function measureContent() {
  if (measurementFrame) return
  measurementFrame = requestAnimationFrame(() => {
    measurementFrame = 0
    headingPositions = outline.value.flatMap(item => {
      const heading = document.getElementById(item.id)
      return heading ? [{ id: item.id, top: heading.getBoundingClientRect().top + window.scrollY }] : []
    })
    maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    updateScroll()
  })
}
function updateScroll() {
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0; showBackToTop.value = window.scrollY > 600
    readingProgress.value = maxScroll > 0 ? Math.min(100, Math.max(0, window.scrollY / maxScroll * 100)) : 0
    let current = outline.value[0]?.id ?? ''
    for (const item of headingPositions) if (item.top <= window.scrollY + 140) current = item.id
    activeHeading.value = current
  })
}
function onVisibility() {
  if (document.visibilityState === 'visible' && !loading.value) void revalidateNavigation()
}
function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  const editing = target.matches('input,textarea,[contenteditable="true"]')
  if (((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') || (event.key === '/' && !editing)) {
    event.preventDefault(); if (!lightbox.value) openSearch()
  }
}
onMounted(() => {
  void loadSite()
  contentObserver = new ResizeObserver(measureContent)
  if (contentRoot.value) contentObserver.observe(contentRoot.value)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('resize', measureContent)
  window.addEventListener('scroll', updateScroll, { passive: true }); window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  disposed = true; navigationGeneration += 1
  cleanupInteractions?.(); articleCache.dispose(); searchController?.abort(); clearTimeout(searchTimer); cancelAnimationFrame(scrollFrame)
  cancelPrefetch(); contentObserver?.disconnect(); cancelAnimationFrame(measurementFrame)
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('resize', measureContent)
  window.removeEventListener('scroll', updateScroll); window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="docs-app">
    <a class="skip-to-content" href="#main-content">跳转到正文</a>
    <SiteHeader active="docs" :console-url="site?.settings.consoleUrl" :progress="!isHome ? readingProgress : undefined">
      <template #leading><button class="icon-button mobile-only" type="button" aria-label="打开导航" @click="sidebarOpen = true"><Menu :size="20" /></button></template>
      <template #actions><button class="search-trigger" type="button" aria-label="搜索文档" @click="openSearch"><Search :size="17" /><span>搜索教程、配置、问题…</span><kbd>Ctrl K</kbd></button></template>
    </SiteHeader>
    <div class="docs-shell" :class="{ 'home-shell': isHome }">
      <div v-if="sidebarOpen" class="sidebar-backdrop" @click="sidebarOpen = false" />
      <aside ref="sidebarRoot" class="docs-sidebar" :class="{ open: sidebarOpen }" :role="sidebarOpen ? 'dialog' : undefined" :aria-modal="sidebarOpen ? true : undefined" aria-label="文档导航">
        <div class="mobile-sidebar-head"><span>文档导航</span><button class="icon-button" type="button" aria-label="关闭导航" @click="sidebarOpen = false"><X :size="19" /></button></div>
        <RouterLink to="/" class="sidebar-intro" :class="{ active: isHome }" aria-label="LinkAPI 开发者文档首页" @click="closeNavigation"><strong><ContentIcon kind="book" :size="18" />LinkAPI 开发者文档</strong></RouterLink>
        <nav v-if="site?.groups.length" aria-label="教程分类">
          <div v-for="group in site.groups" :key="group.id" class="sidebar-group">
            <button :id="`sidebar-group-toggle-${group.id}`" class="sidebar-group-label" :class="{ expanded: expandedSidebarGroups.has(group.id) }" type="button" :aria-expanded="expandedSidebarGroups.has(group.id)" :aria-controls="`sidebar-group-documents-${group.id}`" @click="toggleSidebarGroup(group.id)">
              <span>{{ group.name }}</span><ChevronDown :size="15" :class="{ rotated: expandedSidebarGroups.has(group.id) }" aria-hidden="true" />
            </button>
            <div :id="`sidebar-group-documents-${group.id}`" class="sidebar-group-documents" v-show="expandedSidebarGroups.has(group.id)">
              <RouterLink v-for="doc in group.documents" :key="doc.id" class="sidebar-link" :class="{ active: slug === doc.slug }" :to="{ name: 'docs-document', params: { slug: doc.slug } }" :aria-current="slug === doc.slug ? 'page' : undefined" @pointerenter="prefetchDocument(doc.slug)" @focus="prefetchDocument(doc.slug)" @touchstart.passive="prefetchDocument(doc.slug)" @click="closeNavigation"><ContentIcon :size="15" /><span>{{ doc.navLabel }}</span></RouterLink>
            </div>
          </div>
        </nav>
        <div v-else-if="!loading" class="sidebar-empty">暂无教程</div>
      </aside>
      <main id="main-content" ref="contentRoot" class="docs-main" :class="{ 'home-main': isHome }" tabindex="-1">
        <div v-if="loading || articleLoading" class="article-skeleton" aria-label="正在加载文档" role="status"><div /><div /><div /><div /></div>
        <div v-else-if="loadError" class="page-state error-state"><ContentIcon :size="30" /><h1>暂时无法打开文档</h1><p>{{ loadError }}</p><button class="primary-button" type="button" @click="loadSite">重新加载</button></div>
        <div v-else-if="!allDocuments.length" class="empty-docs"><ContentIcon kind="book" :size="32" /><h1>文档正在准备中</h1><p>教程发布后，会显示在这里。</p></div>
        <template v-else-if="isHome">
          <header class="home-heading"><h1>使用文档</h1></header>
          <section class="home-guides" aria-labelledby="guides-title"><div class="section-heading"><h2 id="guides-title">教程目录</h2><span>{{ allDocuments.length }} 篇教程</span></div>
            <div class="guide-grid"><section v-for="group in site?.groups" :key="group.id" class="guide-card"><div class="guide-card-heading"><span class="guide-icon"><ContentIcon :kind="groupIcon(group.anchor)" :size="24" /></span><h3>{{ group.name }}</h3></div><div class="guide-card-links"><RouterLink v-for="doc in group.documents" :key="doc.id" :to="{ name: 'docs-document', params: { slug: doc.slug } }" @pointerenter="prefetchDocument(doc.slug)" @focus="prefetchDocument(doc.slug)" @touchstart.passive="prefetchDocument(doc.slug)"><span><strong>{{ doc.navLabel }}</strong></span><ArrowRight :size="17" /></RouterLink></div></section></div>
          </section>
        </template>
        <div v-else-if="notFound || !documentDetail" class="empty-docs"><ContentIcon :size="32" /><h1>没有找到这篇教程</h1><p>它可能已移动或尚未发布，可以从文档概览重新查找。</p><RouterLink class="primary-button" to="/">返回文档概览</RouterLink></div>
        <template v-else>
          <section :id="documentDetail.slug" :key="documentDetail.id" class="doc-section">
            <div class="doc-eyebrow"><RouterLink to="/">文档概览</RouterLink><ChevronRight :size="13" /><span>{{ currentGroup?.name }}</span></div>
            <h1>{{ documentDetail.title }}</h1>
            <div class="doc-meta"><span class="guide-badge">使用指南</span><span><Clock3 :size="14" />约 {{ documentDetail.readingMinutes }} 分钟</span><span>更新于 {{ dateLabel(documentDetail.updatedAt) }}</span></div>
            <div v-if="outline.length" class="mobile-outline"><button type="button" :aria-expanded="outlineOpen" @click="outlineOpen = !outlineOpen"><List :size="17" /><span>本页目录</span><ChevronDown :size="16" :class="{ rotated: outlineOpen }" /></button><nav v-if="outlineOpen" aria-label="本页目录"><a v-for="item in outline" :key="item.id" :href="`#${item.id}`" :class="{ nested: item.level === 3, active: activeHeading === item.id }" @click="outlineOpen = false">{{ item.text }}</a></nav></div>
            <article class="markdown-body" v-html="documentDetail.html" />
          </section>
          <nav v-if="previousDocument || nextDocument" class="document-pagination" aria-label="相邻文档"><RouterLink v-if="previousDocument" :to="{ name: 'docs-document', params: { slug: previousDocument.slug } }" class="pagination-card" @pointerenter="prefetchDocument(previousDocument.slug)" @focus="prefetchDocument(previousDocument.slug)" @touchstart.passive="prefetchDocument(previousDocument.slug)"><ArrowLeft :size="18" /><span><small>上一篇</small><strong>{{ previousDocument.navLabel }}</strong></span></RouterLink><RouterLink v-if="nextDocument" :to="{ name: 'docs-document', params: { slug: nextDocument.slug } }" class="pagination-card next" @pointerenter="prefetchDocument(nextDocument.slug)" @focus="prefetchDocument(nextDocument.slug)" @touchstart.passive="prefetchDocument(nextDocument.slug)"><span><small>下一篇</small><strong>{{ nextDocument.navLabel }}</strong></span><ArrowRight :size="18" /></RouterLink></nav>
        </template>
        <footer v-if="!loading && !articleLoading" class="docs-footer"><span class="footer-brand"><img :src="BRAND_ICON_URL" alt="" width="20" height="20" />LinkAPI 开发者文档</span></footer>
      </main>
      <aside v-if="!isHome && outline.length && !articleLoading" class="page-outline"><div class="outline-title"><List :size="14" />本页内容</div><a v-for="item in outline" :key="item.id" :href="`#${item.id}`" class="outline-link" :class="{ nested: item.level === 3, active: activeHeading === item.id }" :aria-current="activeHeading === item.id ? 'location' : undefined">{{ item.text }}</a><a class="outline-top" href="#main-content"><ArrowUp :size="14" />回到顶部</a></aside>
    </div>
    <button v-if="showBackToTop" class="back-to-top" type="button" aria-label="返回顶部" @click="windowScrollTop"><ArrowUp :size="19" /></button>
    <div v-if="searchOpen" class="dialog-backdrop search-backdrop" @mousedown.self="searchOpen = false"><section ref="searchRoot" class="search-dialog" role="dialog" aria-modal="true" aria-label="搜索文档" tabindex="-1"><div class="search-input-wrap"><Search :size="20" /><input v-model="searchQuery" data-autofocus type="search" maxlength="120" aria-label="搜索文档内容" aria-controls="search-results" :aria-activedescendant="visibleResults.length ? `search-result-${searchSelection}` : undefined" placeholder="搜索工具、配置或错误提示…" @keydown="searchKeys" /><button class="icon-button" type="button" aria-label="关闭搜索" @click="searchOpen = false"><X :size="18" /></button></div><div class="search-section-label">{{ searchQuery.trim() ? '搜索结果' : '快速打开教程' }}</div><div id="search-results" class="search-results" role="listbox" aria-label="匹配的教程"><div v-if="searching" class="no-results" role="status">正在查找…</div><div v-else-if="searchError" class="no-results" role="status">{{ searchError }}</div><template v-else><button v-for="(result, index) in visibleResults" :id="`search-result-${index}`" :key="result.slug" type="button" class="search-result" :class="{ selected: index === searchSelection }" role="option" :aria-selected="index === searchSelection" @mouseenter="searchSelection = index" @click="selectResult(result)"><ContentIcon :size="18" /><span><strong><template v-for="(part, p) in highlight(result.title)" :key="p"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></strong><small><template v-for="(part, p) in highlight(result.snippet)" :key="p"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></small><em v-if="result.heading">定位到：{{ result.heading }}</em></span><ArrowRight :size="15" /></button><div v-if="!visibleResults.length" class="no-results"><strong>没有找到匹配的教程</strong><p>试试工具名称、系统名称，或缩短错误提示。</p></div></template></div><div class="search-help"><span><kbd>↑</kbd><kbd>↓</kbd> 选择 <kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></div></section></div>
    <div v-if="lightbox" class="dialog-backdrop image-lightbox" @mousedown.self="lightbox = null"><section ref="lightboxRoot" role="dialog" aria-modal="true" :aria-label="lightbox.alt || '图片预览'" tabindex="-1"><button class="lightbox-close" type="button" aria-label="关闭图片预览" @click="lightbox = null"><X :size="22" /></button><img :src="lightbox.source" :alt="lightbox.alt" /><p>{{ lightbox.alt }}</p></section></div>
  </div>
</template>
