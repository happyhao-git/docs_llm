export interface SnapshotDocument {
  id: number
  title: string
  navLabel: string
  slug: string
  markdown: string
}

export interface SiteSnapshot {
  settings: { siteName: string; subtitle: string; consoleUrl: string; accentColor: string }
  groups: Array<{ id: number; name: string; anchor: string; documents: SnapshotDocument[] }>
}

export function sameDocument(a: SnapshotDocument, b: SnapshotDocument) {
  return a.title === b.title && a.navLabel === b.navLabel && a.slug === b.slug && a.markdown === b.markdown
}

export function comparePublications(current: SiteSnapshot, previous: SiteSnapshot | null) {
  const docs = current.groups.flatMap((group) => group.documents)
  const oldDocs = previous?.groups.flatMap((group) => group.documents) ?? []
  const oldById = new Map(oldDocs.map((doc) => [doc.id, doc]))
  const currentIds = new Set(docs.map((doc) => doc.id))
  const entry = (doc: SnapshotDocument) => ({ id: doc.id, title: doc.title })
  const added = docs.filter((doc) => !oldById.has(doc.id)).map(entry)
  const updated = docs.filter((doc) => oldById.has(doc.id) && !sameDocument(doc, oldById.get(doc.id)!)).map(entry)
  const removed = oldDocs.filter((doc) => !currentIds.has(doc.id)).map(entry)
  const navigation = (snapshot: SiteSnapshot | null) => snapshot?.groups.map((group) => ({
    id: group.id, name: group.name, anchor: group.anchor, documents: group.documents.map((doc) => doc.id)
  })) ?? []
  const navigationChanged = JSON.stringify(navigation(current)) !== JSON.stringify(navigation(previous))
  const settingsChanged = !previous || Object.entries(current.settings).some(([key, value]) => (
    value !== previous.settings[key as keyof SiteSnapshot['settings']]
  ))
  return {
    hasChanges: !previous || Boolean(added.length || updated.length || removed.length || navigationChanged || settingsChanged),
    isFirstPublication: !previous,
    documentCount: docs.length,
    added, updated, removed, navigationChanged, settingsChanged
  }
}

export function documentUpdateTime(
  document: SnapshotDocument,
  previous: (SnapshotDocument & { contentUpdatedAt: Date | null }) | undefined,
  previousPublishedAt: Date | undefined,
  publishedAt: Date
) {
  return previous && sameDocument(document, previous)
    ? previous.contentUpdatedAt ?? previousPublishedAt ?? publishedAt
    : publishedAt
}
