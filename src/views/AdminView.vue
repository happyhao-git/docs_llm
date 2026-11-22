<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import draggable from 'vuedraggable'
import {
  Bold,
  ListCollapse,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Code2,
  Eye,
  EyeOff,
  FilePlus2,
  GripVertical,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  LogOut,
  Menu,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Send,
  Settings,
  Trash2,
  X
} from 'lucide-vue-next'
import AppModal from '@/components/AppModal.vue'
import ContentIcon from '@/components/site/ContentIcon.vue'
import { BRAND_ICON_URL } from '@/lib/brand'
import { api, ApiError, jsonBody } from '@/lib/api'
import { initializeDocInteractions } from '@/lib/docs-interactions'
import { clipboardImages, moveImageInsertion } from '@/lib/editor-images'
import { useDialog } from '@/lib/use-dialog'
import type { AdminContent, DraftDocument, DraftGroup, PublicationItem, PublicationStatus, SiteSettings } from '@/types'

const router = useRouter()
const content = ref<AdminContent | null>(null)
const selectedDocumentId = ref<number | null>(null)
const expandedGroups = ref(new Set<number>())
const loading = ref(true)
const saving = ref(false)
const publishing = ref(false)
const uploading = ref(false)
const creatingDocumentGroupId = ref<number | null>(null)
const deletingDocumentIds = ref(new Set<number>())
const changingDocuments = computed(() => creatingDocumentGroupId.value !== null || deletingDocumentIds.value.size > 0)
const editorMode = ref<'edit' | 'split' | 'preview'>('split')
const compactEditor = ref(false)
const effectiveEditorMode = computed(() => compactEditor.value && editorMode.value === 'split' ? 'edit' : editorMode.value)
let editorMedia: MediaQueryList | undefined
const onEditorResize = () => { compactEditor.value = editorMedia?.matches ?? false }
const saveShortcut = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void saveDocument()
  }
}
const checkingPublication = ref(false)
const publicationStatus = ref<PublicationStatus | null>(null)
const publishModalOpen = ref(false)
const savedDocuments = new Map<number, string>()
const publicationLabel = computed(() => {
  if (publishing.value) return '发布中…'
  if (checkingPublication.value) return '检查变更…'
  if (dirtyDocuments.value.size) return '请先保存草稿'
  return publicationStatus.value?.changes.hasChanges === false ? '已是最新' : '发布站点'
})
const canPublish = computed(() => !loading.value && !saving.value && !publishing.value && !checkingPublication.value
  && !changingDocuments.value && !dirtyDocuments.value.size && publicationStatus.value?.changes.hasChanges !== false)

function documentFields(document: DraftDocument) {
  return { groupId: document.groupId, title: document.title, navLabel: document.navLabel,
    slug: document.slug, markdown: document.markdown, isVisible: document.isVisible }
}

async function refreshPublicationStatus() {
  publicationStatus.value = await guarded(() => api<PublicationStatus>('/api/admin/publication-status')) ?? null
  if (content.value && publicationStatus.value) content.value.activePublicationId = publicationStatus.value.activePublicationId
}
const previewHtml = ref('')
const previewRoot = ref<HTMLElement | null>(null)
const editor = ref<HTMLTextAreaElement | null>(null)
const sidebarOpen = ref(false)
const sidebarRoot = ref<HTMLElement | null>(null)
useDialog(sidebarOpen, sidebarRoot, () => { sidebarOpen.value = false })
let previewGeneration = 0
const dirtyDocuments = ref(new Set<number>())
const toast = ref<{ message: string; type: 'success' | 'error' } | null>(null)
let toastTimer: number | undefined
let previewTimer: number | undefined
let cleanupPreview: (() => void) | undefined

const settingsModalOpen = ref(false)
const groupModalOpen = ref(false)
const historyModalOpen = ref(false)
const passwordModalOpen = ref(false)
const confirmOpen = ref(false)
const confirmTitle = ref('')
const confirmMessage = ref('')
let confirmHandler: (() => Promise<void>) | undefined

const settingsForm = reactive<SiteSettings>({ siteName: '', subtitle: '', consoleUrl: '', accentColor: '#6d4aff' })
const groupForm = reactive({ id: 0, name: '', anchor: '', isVisible: true })
const passwordForm = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })
const publications = ref<PublicationItem[]>([])
const activePublicationId = ref<number | null>(null)

const selectedDocument = computed<DraftDocument | null>(() => {
  for (const group of content.value?.groups ?? []) {
    const document = group.documents.find((item) => item.id === selectedDocumentId.value)
    if (document) return document
  }
  return null
})

const selectedGroup = computed(() => content.value?.groups.find((group) => group.id === selectedDocument.value?.groupId) ?? null)

function notify(message: string, type: 'success' | 'error' = 'success') {
  toast.value = { message, type }
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toast.value = null }, 2800)
}

async function guarded<T>(operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await router.replace('/admin/login')
      return undefined
    }
    notify(error instanceof Error ? error.message : '操作失败', 'error')
    return undefined
  }
}

async function loadContent(preferredDocumentId?: number) {
  const result = await guarded(() => api<AdminContent>('/api/admin/content'))
  if (!result) return
  // Keep unsaved edits in other articles when refreshing the content tree.
  const unsaved = new Map(content.value?.groups.flatMap((group) => group.documents)
    .filter((doc) => dirtyDocuments.value.has(doc.id)).map((doc) => [doc.id, doc]) ?? [])
  savedDocuments.clear()
  result.groups.forEach((group) => group.documents.forEach((doc) => {
    savedDocuments.set(doc.id, JSON.stringify(documentFields(doc)))
    const local = unsaved.get(doc.id)
    if (local) Object.assign(doc, documentFields(local), { groupId: group.id })
  }))
  content.value = result
  publicationStatus.value = result.publicationStatus
  dirtyDocuments.value = new Set(result.groups.flatMap((group) => group.documents)
    .filter((doc) => savedDocuments.get(doc.id) !== JSON.stringify(documentFields(doc))).map((doc) => doc.id))
  result.groups.forEach((group) => expandedGroups.value.add(group.id))
  const all = result.groups.flatMap((group) => group.documents)
  selectedDocumentId.value = preferredDocumentId && all.some((item) => item.id === preferredDocumentId)
    ? preferredDocumentId
    : selectedDocumentId.value && all.some((item) => item.id === selectedDocumentId.value)
      ? selectedDocumentId.value
      : all[0]?.id ?? null
  loading.value = false
}

function toggleGroup(id: number) {
  const next = new Set(expandedGroups.value)
  next.has(id) ? next.delete(id) : next.add(id)
  expandedGroups.value = next
}

async function addGroup() {
  const result = await guarded(() => api<{ id: number }>('/api/admin/groups', {
    method: 'POST',
    body: jsonBody({ name: '新分组', isVisible: true })
  }))
  if (!result) return
  await loadContent()
  openGroupEditor(content.value?.groups.find((group) => group.id === result.id))
}

function openGroupEditor(group?: DraftGroup) {
  if (!group) return
  Object.assign(groupForm, { id: group.id, name: group.name, anchor: group.anchor, isVisible: group.isVisible })
  groupModalOpen.value = true
}

async function saveGroup() {
  const result = await guarded(() => api(`/api/admin/groups/${groupForm.id}`, {
    method: 'PUT',
    body: jsonBody({ name: groupForm.name, anchor: groupForm.anchor, isVisible: groupForm.isVisible })
  }))
  if (!result) return
  groupModalOpen.value = false
  await loadContent()
  notify('导航分组已保存')
}

function askDeleteGroup(group: DraftGroup) {
  confirmTitle.value = '删除导航分组'
  confirmMessage.value = group.documents.length ? `“${group.name}”及其中 ${group.documents.length} 篇草稿将被删除。已发布版本不会立即改变。` : `确定删除“${group.name}”吗？`
  confirmHandler = async () => {
    const result = await guarded(() => api(`/api/admin/groups/${group.id}`, { method: 'DELETE' }))
    if (!result) return
    await loadContent()
    notify('导航分组已删除')
  }
  confirmOpen.value = true
}

async function addDocument(groupId: number) {
  if (changingDocuments.value) return
  creatingDocumentGroupId.value = groupId
  try {
    const result = await guarded(() => api<{ id: number }>('/api/admin/documents', {
      method: 'POST', body: jsonBody({ groupId })
    }))
    if (!result) return
    expandedGroups.value.add(groupId)
    await loadContent(result.id)
    sidebarOpen.value = false
    await nextTick(() => editor.value?.focus())
  } finally {
    creatingDocumentGroupId.value = null
  }
}

async function saveDocument() {
  const document = selectedDocument.value
  if (!document || saving.value || !dirtyDocuments.value.has(document.id)) return
  saving.value = true
  const fields = documentFields(document)
  const result = await guarded(() => api<{ slug: string }>(`/api/admin/documents/${document.id}`, {
    method: 'PUT', body: jsonBody(fields)
  }))
  saving.value = false
  if (!result) return
  if (document.slug === fields.slug) document.slug = result.slug
  savedDocuments.set(document.id, JSON.stringify({ ...fields, slug: result.slug }))
  const next = new Set(dirtyDocuments.value)
  if (savedDocuments.get(document.id) === JSON.stringify(documentFields(document))) next.delete(document.id)
  dirtyDocuments.value = next
  await refreshPublicationStatus()
  notify('草稿已保存，发布后客户可见')
}

async function askDeleteDocument(document: DraftDocument) {
  if (changingDocuments.value || (saving.value && selectedDocumentId.value === document.id)) return
  const documentId = document.id
  const title = document.title.trim() || document.navLabel.trim() || '未命名文档'
  confirmTitle.value = '删除文档草稿'
  confirmMessage.value = `确定删除“${title}”吗？${dirtyDocuments.value.has(documentId) ? '这篇文档未保存的修改也会删除。' : ''}已发布站点会保持不变，直到下次发布。`
  confirmHandler = async () => {
    if (deletingDocumentIds.value.has(documentId)) return
    deletingDocumentIds.value = new Set([...deletingDocumentIds.value, documentId])
    try {
      const result = await guarded(() => api(`/api/admin/documents/${documentId}`, { method: 'DELETE' }))
      if (!result) return
      const all = content.value?.groups.flatMap((group) => group.documents) ?? []
      const index = all.findIndex((doc) => doc.id === documentId)
      const wasSelected = selectedDocumentId.value === documentId
      const nextId = wasSelected ? (all[index + 1] ?? all[index - 1])?.id : selectedDocumentId.value ?? undefined
      const next = new Set(dirtyDocuments.value)
      next.delete(documentId)
      dirtyDocuments.value = next
      savedDocuments.delete(documentId)
      await loadContent(nextId)
      if (wasSelected) await nextTick(() => editor.value?.focus())
      notify('文档草稿已删除')
    } finally {
      const next = new Set(deletingDocumentIds.value)
      next.delete(documentId)
      deletingDocumentIds.value = next
    }
  }
  // Close the mobile navigation before opening a confirmation dialog.
  if (sidebarOpen.value) { sidebarOpen.value = false; await nextTick() }
  confirmOpen.value = true
}

async function reorderContent() {
  if (!content.value) return
  content.value.groups.forEach((group, groupIndex) => {
    group.sortOrder = groupIndex
    group.documents.forEach((document, docIndex) => {
      document.groupId = group.id
      document.sortOrder = docIndex
    })
  })
  const result = await guarded(() => api('/api/admin/reorder', {
    method: 'PUT',
    body: jsonBody({ groups: content.value!.groups.map((group) => ({ id: group.id, documentIds: group.documents.map((doc) => doc.id) })) })
  }))
  if (result) {
    for (const group of content.value.groups) {
      for (const document of group.documents) {
        const saved = savedDocuments.get(document.id)
        if (saved) savedDocuments.set(document.id, JSON.stringify({ ...JSON.parse(saved), groupId: group.id }))
      }
    }
    await refreshPublicationStatus()
  }
}

function markDirty() {
  if (!selectedDocument.value) return
  const document = selectedDocument.value
  const next = new Set(dirtyDocuments.value)
  if (savedDocuments.get(document.id) === JSON.stringify(documentFields(document))) next.delete(document.id)
  else next.add(document.id)
  dirtyDocuments.value = next
}

function wrapSelection(before: string, after = before, placeholder = '文本') {
  const input = editor.value
  const document = selectedDocument.value
  if (!input || !document) return
  const start = input.selectionStart
  const end = input.selectionEnd
  const selected = document.markdown.slice(start, end) || placeholder
  document.markdown = `${document.markdown.slice(0, start)}${before}${selected}${after}${document.markdown.slice(end)}`
  markDirty()
  nextTick(() => {
    input.focus()
    input.setSelectionRange(start + before.length, start + before.length + selected.length)
  })
}

function insertBlock(value: string) {
  const input = editor.value
  const document = selectedDocument.value
  if (!input || !document) return
  const start = input.selectionStart
  const prefix = start > 0 && document.markdown[start - 1] !== '\n' ? '\n' : ''
  document.markdown = `${document.markdown.slice(0, start)}${prefix}${value}${document.markdown.slice(start)}`
  markDirty()
  nextTick(() => input.focus())
}

async function uploadImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await uploadImages([file])
}

function pasteImages(event: ClipboardEvent) {
  const files = clipboardImages(event.clipboardData)
  if (!files.length) return
  event.preventDefault()
  void uploadImages(files)
}

async function uploadImages(files: File[]) {
  const documentId = selectedDocument.value?.id
  if (!documentId) return
  if (uploading.value) {
    notify('图片正在上传，请稍后再试', 'error')
    return
  }
  // Resolve by ID so switching articles or reloading the tree cannot insert
  // the image into another article or discard it with an old draft object.
  const targetDocument = () => content.value?.groups.flatMap(group => group.documents).find(doc => doc.id === documentId)
  let position = editor.value?.selectionStart ?? selectedDocument.value!.markdown.length
  let inserting = false
  const stopTracking = watch(() => targetDocument()?.markdown, (next, previous) => {
    if (!inserting && next !== undefined && previous !== undefined) position = moveImageInsertion(position, previous, next)
  }, { flush: 'sync' })
  uploading.value = true
  try {
    for (const file of files) {
      if (!targetDocument()) return
      const form = new FormData()
      form.append('file', file)
      const result = await guarded(() => api<{ url: string }>('/api/admin/uploads', { method: 'POST', body: form }))
      if (!result) return
      const document = targetDocument()
      if (!document) return
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[\[\]\\\r\n]/g, '') || '图片'
      const prefix = position > 0 && document.markdown[position - 1] !== '\n' ? '\n' : ''
      const markdown = `${prefix}![${alt}](${result.url})\n`
      const input = selectedDocumentId.value === documentId ? editor.value : null
      const restoreCaret = input === window.document.activeElement && input?.selectionStart === position && input.selectionEnd === position
      inserting = true
      document.markdown = `${document.markdown.slice(0, position)}${markdown}${document.markdown.slice(position)}`
      inserting = false
      position += markdown.length
      dirtyDocuments.value = new Set([...dirtyDocuments.value, document.id])
      await nextTick()
      if (restoreCaret && selectedDocumentId.value === documentId) input?.setSelectionRange(position, position)
    }
    notify('图片已上传并插入')
  } finally {
    stopTracking()
    uploading.value = false
  }
}

async function updatePreview() {
  const generation = ++previewGeneration
  if (!selectedDocument.value) {
    previewHtml.value = ''
    return
  }
  const result = await guarded(() => api<{ html: string }>('/api/admin/preview', {
    method: 'POST', body: jsonBody({ markdown: selectedDocument.value!.markdown })
  }))
  if (!result || generation !== previewGeneration) return
  previewHtml.value = result.html
  await nextTick()
  cleanupPreview?.()
  if (previewRoot.value) cleanupPreview = initializeDocInteractions(previewRoot.value)
}

watch(() => selectedDocument.value?.markdown, () => {
  window.clearTimeout(previewTimer)
  previewTimer = window.setTimeout(() => void updatePreview(), 280)
})
watch(selectedDocumentId, () => { previewHtml.value = ''; void updatePreview() })

function openSettings() {
  if (!content.value) return
  Object.assign(settingsForm, content.value.settings)
  settingsModalOpen.value = true
}

async function saveSettings() {
  const result = await guarded(() => api<{ settings: SiteSettings }>('/api/admin/settings', {
    method: 'PUT', body: jsonBody(settingsForm)
  }))
  if (!result || !content.value) return
  Object.assign(content.value.settings, result.settings)
  settingsModalOpen.value = false
  await refreshPublicationStatus()
  notify('站点设置已保存，发布后生效')
}

async function askPublish() {
  if (!canPublish.value) return
  checkingPublication.value = true
  await refreshPublicationStatus()
  checkingPublication.value = false
  if (!publicationStatus.value) return
  if (!publicationStatus.value.changes.hasChanges) {
    notify('与线上版本一致，无需重复发布')
    return
  }
  publishModalOpen.value = true
}

async function publishSite() {
  if (!canPublish.value) return
  publishing.value = true
  const result = await guarded(() => api<{ id: number; documentCount: number; unchanged: boolean }>('/api/admin/publications', { method: 'POST' }))
  if (result) {
    publishModalOpen.value = false
    if (content.value) content.value.activePublicationId = result.id
    await refreshPublicationStatus()
    notify(result.unchanged ? '与线上版本一致，无需重复发布' : `版本 #${result.id} 已发布`)
  }
  publishing.value = false
}

async function runConfirm() {
  const handler = confirmHandler
  confirmOpen.value = false
  confirmHandler = undefined
  if (handler) await handler()
}

async function openHistory() {
  const result = await guarded(() => api<{ activePublicationId: number | null; items: PublicationItem[] }>('/api/admin/publications'))
  if (!result) return
  publications.value = result.items
  activePublicationId.value = result.activePublicationId
  historyModalOpen.value = true
}

function askRestore(item: PublicationItem) {
  historyModalOpen.value = false
  confirmTitle.value = '恢复历史版本到草稿'
  confirmMessage.value = `当前草稿将替换为 ${new Date(item.createdAt).toLocaleString('zh-CN')} 的版本，线上站点保持不变，直到重新发布。`
  confirmHandler = async () => {
    const result = await guarded(() => api(`/api/admin/publications/${item.id}/restore`, { method: 'POST' }))
    if (!result) return
    dirtyDocuments.value = new Set()
    await loadContent()
    notify('历史版本已恢复到草稿')
  }
  confirmOpen.value = true
}

async function changePassword() {
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    notify('两次输入的新密码不一致', 'error')
    return
  }
  const result = await guarded(() => api('/api/admin/password', {
    method: 'PUT', body: jsonBody({ currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword })
  }))
  if (!result) return
  passwordModalOpen.value = false
  await router.replace('/admin/login')
}

async function logout() {
  if (dirtyDocuments.value.size && !window.confirm('有未保存的修改，确定放弃修改并退出登录吗？')) return
  dirtyDocuments.value = new Set()
  await guarded(() => api('/api/admin/logout', { method: 'POST' }))
  await router.replace('/admin/login')
}

const beforeUnload = (event: BeforeUnloadEvent) => {
  if (dirtyDocuments.value.size) { event.preventDefault(); event.returnValue = '' }
}

onBeforeRouteLeave(() => !dirtyDocuments.value.size || window.confirm('有未保存的修改，确定离开编辑页面吗？'))

onMounted(async () => {
  editorMedia = window.matchMedia('(max-width: 900px)')
  onEditorResize()
  editorMedia.addEventListener('change', onEditorResize)
  window.addEventListener('keydown', saveShortcut)
  await loadContent()
  await updatePreview()
  window.addEventListener('beforeunload', beforeUnload)
})

onBeforeUnmount(() => {
  cleanupPreview?.()
  editorMedia?.removeEventListener('change', onEditorResize)
  window.removeEventListener('keydown', saveShortcut)
  window.clearTimeout(previewTimer)
  window.clearTimeout(toastTimer)
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<template>
  <div class="admin-app">
    <header class="admin-header">
      <button class="icon-button admin-mobile-menu" type="button" aria-label="打开内容导航" @click="sidebarOpen = true"><Menu :size="19" /></button>
      <a class="brand admin-brand" href="/" target="_blank" rel="noopener noreferrer">
        <img class="brand-mark" :src="BRAND_ICON_URL" alt="" width="32" height="32" /><span>文档管理</span>
      </a>
      <div class="admin-header-status">
        <span class="status-dot" :class="{ published: content?.activePublicationId }" />
        {{ content?.activePublicationId ? `线上版本 #${content.activePublicationId}` : '尚未发布' }}
        <span v-if="publicationStatus?.changes.hasChanges" class="pending-badge">有待发布变更</span>
      </div>
      <div class="admin-header-actions">
        <RouterLink class="text-button" to="/admin/models">模型管理</RouterLink>
        <button class="text-button" type="button" aria-label="发布记录" @click="openHistory"><Clock3 :size="16" /> 发布记录</button>
        <button class="text-button" type="button" aria-label="站点设置" @click="openSettings"><Settings :size="16" /> 站点设置</button>
        <button class="primary-button publish-button" :class="{ synced: publicationStatus?.changes.hasChanges === false && !dirtyDocuments.size }" type="button" :disabled="!canPublish" :title="dirtyDocuments.size ? '请先保存所有修改的草稿' : publicationStatus?.changes.hasChanges === false ? '可见文档、导航和站点设置均与线上一致' : '查看本次发布的变更'" @click="askPublish">
          <Check v-if="publicationStatus?.changes.hasChanges === false && !dirtyDocuments.size" :size="16" /><Send v-else :size="16" /> {{ publicationLabel }}
        </button>
        <button class="icon-button" type="button" aria-label="退出登录" @click="logout"><LogOut :size="18" /></button>
      </div>
    </header>

    <div v-if="loading" class="page-state admin-loading"><span class="loading-ring" /></div>
    <div v-else class="admin-shell">
      <div v-if="sidebarOpen" class="sidebar-backdrop" @click="sidebarOpen = false" />
      <aside ref="sidebarRoot" class="admin-sidebar" :class="{ open: sidebarOpen }" :role="sidebarOpen ? 'dialog' : undefined" :aria-modal="sidebarOpen ? true : undefined" aria-label="内容导航">
        <div class="admin-sidebar-head">
          <span>内容结构</span>
          <div>
            <button class="icon-button" type="button" title="新增分组" aria-label="新增分组" @click="addGroup"><Plus :size="17" /></button>
            <button class="icon-button admin-sidebar-close" type="button" aria-label="关闭导航" @click="sidebarOpen = false"><X :size="17" /></button>
          </div>
        </div>
        <draggable
          v-if="content"
          v-model="content.groups"
          item-key="id"
          handle=".group-drag-handle"
          class="admin-tree"
          :disabled="changingDocuments"
          @end="reorderContent"
        >
          <template #item="{ element: group }: { element: DraftGroup }">
            <section class="tree-group" :data-group-id="group.id">
              <div class="tree-group-row">
                <button class="drag-handle group-drag-handle" type="button" aria-label="拖动分组"><GripVertical :size="15" /></button>
                <button class="tree-expand" type="button" :aria-label="`${expandedGroups.has(group.id) ? '收起' : '展开'}分组：${group.name}`" :aria-expanded="expandedGroups.has(group.id)" @click="toggleGroup(group.id)">
                  <ChevronDown v-if="expandedGroups.has(group.id)" :size="15" /><ChevronRight v-else :size="15" />
                </button>
                <span class="tree-group-name" :class="{ muted: !group.isVisible }">{{ group.name }}</span>
                <button class="tree-action" type="button" title="编辑分组" :aria-label="`编辑分组：${group.name}`" @click="openGroupEditor(group)"><Pencil :size="14" /></button>
                <button class="tree-action danger" type="button" title="删除分组" :aria-label="`删除分组：${group.name}`" :disabled="changingDocuments" @click="askDeleteGroup(group)"><Trash2 :size="14" /></button>
                <button class="tree-action group-add-document" type="button" :title="creatingDocumentGroupId === group.id ? '正在新建文档…' : '新建文档'" :aria-label="`在${group.name}中新增文档`" :disabled="changingDocuments" @click="addDocument(group.id)"><Plus :size="16" /></button>
              </div>
              <draggable
                v-show="expandedGroups.has(group.id)"
                v-model="group.documents"
                item-key="id"
                group="documents"
                handle=".doc-drag-handle"
                class="tree-documents"
                :disabled="changingDocuments"
                @end="reorderContent"
              >
                <template #item="{ element: document }: { element: DraftDocument }">
                  <div
                    class="tree-document"
                    :data-document-id="document.id"
                    :class="{ active: selectedDocumentId === document.id, muted: !document.isVisible }"
                  >
                    <span class="drag-handle doc-drag-handle" aria-hidden="true"><GripVertical :size="14" /></span>
                    <button class="tree-document-select" type="button" :aria-current="selectedDocumentId === document.id ? 'page' : undefined" @click="selectedDocumentId = document.id; sidebarOpen = false">
                      <ContentIcon :size="15" />
                      <span class="tree-document-label">{{ document.navLabel || '未命名文档' }}</span>
                      <i v-if="dirtyDocuments.has(document.id)" class="dirty-dot" aria-label="有未保存修改" />
                    </button>
                    <button class="tree-action danger document-delete" type="button" title="删除文档" :aria-label="`删除文档：${document.title || document.navLabel || '未命名文档'}`" :disabled="changingDocuments || (saving && selectedDocumentId === document.id)" @click.stop="askDeleteDocument(document)"><Trash2 :size="14" /></button>
                  </div>
                </template>
              </draggable>
            </section>
          </template>
        </draggable>
        <div v-if="!content?.groups.length" class="admin-tree-empty">
          <ContentIcon :size="22" />
          <span>创建第一个导航分组</span>
          <button class="secondary-button" type="button" @click="addGroup"><Plus :size="15" /> 新增分组</button>
        </div>
        <button class="account-settings-link" type="button" @click="passwordModalOpen = true">修改管理员密码</button>
      </aside>

      <main v-if="selectedDocument" class="admin-editor">
        <div class="document-meta-bar">
          <div class="document-title-field"><label for="article-title">文章标题</label><input id="article-title" v-model="selectedDocument.title" maxlength="180" @input="markDirty" /></div>
          <div class="meta-actions">
            <button class="primary-button" type="button" :disabled="saving || !dirtyDocuments.has(selectedDocument.id)" @click="saveDocument"><Save :size="16" />{{ saving ? '保存中…' : '保存草稿' }}</button>
          </div>
        </div>
        <details class="article-properties">
          <summary>文章属性 · {{ selectedDocument.isVisible ? '发布后可见' : '发布后隐藏' }}</summary>
          <div class="meta-fields">
            <label><span>侧栏显示名称</span><input v-model="selectedDocument.navLabel" maxlength="120" @input="markDirty" /></label>
            <label><span>链接标识（修改会影响已分享链接）</span><input v-model="selectedDocument.slug" maxlength="180" @input="markDirty" /></label>
            <label class="check-field"><input v-model="selectedDocument.isVisible" type="checkbox" @change="markDirty" /><span>发布后显示这篇文章</span></label>
            <button class="text-button delete-article" type="button" :disabled="changingDocuments || saving" @click="askDeleteDocument(selectedDocument)"><Trash2 :size="15" />删除文档草稿</button>
          </div>
        </details>

        <div class="editor-toolbar" aria-label="Markdown 工具栏">
          <button type="button" title="标题" aria-label="插入标题" @click="insertBlock('## 标题\n')"><Heading2 :size="17" /></button>
          <button type="button" title="粗体" aria-label="插入粗体" @click="wrapSelection('**')"><Bold :size="17" /></button>
          <button type="button" title="斜体" aria-label="插入斜体" @click="wrapSelection('*')"><Italic :size="17" /></button>
          <button type="button" title="链接" aria-label="插入链接" @click="wrapSelection('[', '](https://)', '链接文本')"><Link2 :size="17" /></button>
          <button type="button" title="代码块" aria-label="插入代码块" @click="insertBlock('```bash\n代码\n```\n')"><Code2 :size="17" /></button>
          <label class="toolbar-upload" title="上传图片，也可在正文中粘贴图片">
            <ImagePlus :size="17" /><input :disabled="uploading" type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="uploadImage" />
          </label>
          <button type="button" title="插入折叠说明" aria-label="插入折叠说明" @click="insertBlock('::: details 查看详细说明\n在这里填写补充说明。\n:::\n')"><ListCollapse :size="17" /></button>
          <span class="toolbar-spacer" />
          <span v-if="uploading" class="upload-progress" role="status">图片上传中…</span>
          <span v-if="dirtyDocuments.has(selectedDocument.id)" class="unsaved-label">有未保存修改</span>
          <span v-else class="saved-label"><Check :size="14" /> 已保存到草稿</span>
          <div class="editor-mode-switch" role="group" aria-label="编辑器显示模式">
            <button type="button" :class="{ active: effectiveEditorMode === 'edit' }" :aria-pressed="effectiveEditorMode === 'edit'" @click="editorMode = 'edit'">编辑</button>
            <button type="button" class="mode-split" :class="{ active: effectiveEditorMode === 'split' }" :aria-pressed="effectiveEditorMode === 'split'" @click="editorMode = 'split'">分屏</button>
            <button type="button" :class="{ active: effectiveEditorMode === 'preview' }" :aria-pressed="effectiveEditorMode === 'preview'" @click="editorMode = 'preview'">预览</button>
          </div>
        </div>

        <div class="editor-split" :class="`mode-${effectiveEditorMode}`">
          <section class="editor-pane">
            <div class="pane-label">Markdown</div>
            <textarea
              ref="editor"
              v-model="selectedDocument.markdown"
              aria-label="Markdown 正文"
              spellcheck="false"
              placeholder="在这里输入 Markdown 内容..."
              @input="markDirty"
              @paste="pasteImages"
            />
          </section>
          <section class="preview-pane">
            <div class="pane-label">预览</div>
            <article v-if="previewHtml" ref="previewRoot" class="markdown-body admin-preview" v-html="previewHtml" />
            <div v-else class="preview-empty">预览区域</div>
          </section>
        </div>
      </main>
      <main v-else class="no-document-selected">
        <FilePlus2 :size="28" />
        <h1>选择或新建一篇文档</h1>
      </main>
    </div>

    <Transition name="toast">
      <div v-if="toast" class="toast-message" role="status" aria-live="polite" :class="toast.type">{{ toast.message }}</div>
    </Transition>

    <AppModal :open="settingsModalOpen" title="站点设置" @close="settingsModalOpen = false">
      <div class="form-grid">
        <label class="field-label"><span>站点名称</span><input v-model="settingsForm.siteName" maxlength="120" /></label>
        <label class="field-label"><span>副标题</span><input v-model="settingsForm.subtitle" maxlength="255" /></label>
        <label class="field-label full"><span>控制台地址</span><input v-model="settingsForm.consoleUrl" type="url" /></label>
        <label class="field-label"><span>主题色</span><span class="color-field"><input v-model="settingsForm.accentColor" type="color" /><input v-model="settingsForm.accentColor" pattern="^#[0-9a-fA-F]{6}$" /></span></label>
      </div>
      <template #footer><button class="secondary-button" type="button" @click="settingsModalOpen = false">取消</button><button class="primary-button" type="button" @click="saveSettings">保存设置</button></template>
    </AppModal>

    <AppModal :open="groupModalOpen" title="编辑导航分组" width="small" @close="groupModalOpen = false">
      <div class="form-stack">
        <label class="field-label"><span>分组名称</span><input v-model="groupForm.name" maxlength="120" /></label>
        <label class="field-label"><span>分组锚点</span><input v-model="groupForm.anchor" maxlength="160" /></label>
        <label class="check-field"><input v-model="groupForm.isVisible" type="checkbox" /><span>发布时显示该分组</span></label>
      </div>
      <template #footer><button class="secondary-button" type="button" @click="groupModalOpen = false">取消</button><button class="primary-button" type="button" @click="saveGroup">保存分组</button></template>
    </AppModal>

    <AppModal :open="publishModalOpen" title="确认发布变更" @close="!publishing && (publishModalOpen = false)">
      <template v-if="publicationStatus">
        <p class="publish-intro">{{ publicationStatus.changes.isFirstPublication ? '首次发布后，客户即可访问文档。' : `本次变更将发布到客户站点，当前线上版本为 #${publicationStatus.activePublicationId}。` }}</p>
        <div class="publish-counts">
          <div><strong>{{ publicationStatus.changes.added.length }}</strong><span>新增文档</span></div>
          <div><strong>{{ publicationStatus.changes.updated.length }}</strong><span>修改文档</span></div>
          <div><strong>{{ publicationStatus.changes.removed.length }}</strong><span>移除文档</span></div>
        </div>
        <ul class="publish-changes">
          <li v-for="item in publicationStatus.changes.added" :key="`add-${item.id}`"><span class="change-tag">新增</span>{{ item.title }}</li>
          <li v-for="item in publicationStatus.changes.updated" :key="`update-${item.id}`"><span class="change-tag">修改</span>{{ item.title }}</li>
          <li v-for="item in publicationStatus.changes.removed" :key="`remove-${item.id}`"><span class="change-tag removed">移除</span>{{ item.title }}</li>
          <li v-if="publicationStatus.changes.navigationChanged"><span class="change-tag">导航</span>导航结构或显示顺序有变更</li>
          <li v-if="publicationStatus.changes.settingsChanged"><span class="change-tag">设置</span>站点信息有变更</li>
        </ul>
        <p class="publish-note">发布后共 {{ publicationStatus.changes.documentCount }} 篇可见文档。未修改文章的更新时间保持不变。</p>
      </template>
      <template #footer>
        <button class="secondary-button" type="button" :disabled="publishing" @click="publishModalOpen = false">取消</button>
        <button class="primary-button" type="button" :disabled="!canPublish" @click="publishSite"><Send :size="15" />{{ publishing ? '发布中…' : '确认发布' }}</button>
      </template>
    </AppModal>

    <AppModal :open="historyModalOpen" title="发布记录" width="large" @close="historyModalOpen = false">
      <div v-if="publications.length" class="publication-list">
        <div v-for="item in publications" :key="item.id" class="publication-row">
          <div><strong>版本 #{{ item.id }}</strong><span v-if="item.id === activePublicationId" class="current-badge">当前线上</span><small>{{ new Date(item.createdAt).toLocaleString('zh-CN') }} · {{ item.username }} · {{ item.documentCount }} 篇</small></div>
          <button class="secondary-button" type="button" @click="askRestore(item)"><RotateCcw :size="15" /> 恢复到草稿</button>
        </div>
      </div>
      <div v-else class="modal-empty">还没有发布记录</div>
    </AppModal>

    <AppModal :open="passwordModalOpen" title="修改管理员密码" width="small" @close="passwordModalOpen = false">
      <div class="form-stack">
        <label class="field-label"><span>当前密码</span><input v-model="passwordForm.currentPassword" type="password" autocomplete="current-password" /></label>
        <label class="field-label"><span>新密码</span><input v-model="passwordForm.newPassword" type="password" autocomplete="new-password" /></label>
        <label class="field-label"><span>确认新密码</span><input v-model="passwordForm.confirmPassword" type="password" autocomplete="new-password" /></label>
      </div>
      <template #footer><button class="secondary-button" type="button" @click="passwordModalOpen = false">取消</button><button class="primary-button" type="button" @click="changePassword">修改密码</button></template>
    </AppModal>

    <AppModal :open="confirmOpen" :title="confirmTitle" width="small" @close="confirmOpen = false">
      <p class="confirm-message">{{ confirmMessage }}</p>
      <template #footer><button class="secondary-button" type="button" @click="confirmOpen = false">取消</button><button v-if="confirmHandler" class="primary-button" type="button" @click="runConfirm">确认</button></template>
    </AppModal>
  </div>
</template>
