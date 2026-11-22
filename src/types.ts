export interface SiteSettings {
  siteName: string
  subtitle: string
  consoleUrl: string
  accentColor: string
}

export interface PublicDocument {
  id: number
  title: string
  navLabel: string
  slug: string
  html: string
  searchText: string
  updatedAt: string
}

export interface PublicGroup {
  id: number
  name: string
  anchor: string
  documents: PublicDocument[]
}

export interface PublicSite {
  settings: SiteSettings
  publication: { id: number; createdAt: string } | null
  groups: PublicGroup[]
}

export interface DraftDocument {
  id: number
  groupId: number
  title: string
  navLabel: string
  slug: string
  markdown: string
  sortOrder: number
  isVisible: boolean
  createdAt: string
  updatedAt: string
}

export interface DraftGroup {
  id: number
  name: string
  anchor: string
  sortOrder: number
  isVisible: boolean
  createdAt: string
  updatedAt: string
  documents: DraftDocument[]
}

export interface AdminContent {
  settings: SiteSettings & { id: number; createdAt: string; updatedAt: string }
  activePublicationId: number | null
  publicationStatus: PublicationStatus
  groups: DraftGroup[]
}

export interface PublicationStatus {
  activePublicationId: number | null
  changes: {
    hasChanges: boolean
    isFirstPublication: boolean
    documentCount: number
    added: Array<{ id: number; title: string }>
    updated: Array<{ id: number; title: string }>
    removed: Array<{ id: number; title: string }>
    navigationChanged: boolean
    settingsChanged: boolean
  }
}

export interface PublicationItem {
  id: number
  documentCount: number
  createdAt: string
  username: string
}

export interface DocumentSummary {
  id: number
  title: string
  navLabel: string
  slug: string
  summary: string
  updatedAt: string
  readingMinutes: number
}
export interface NavigationSite {
  settings: SiteSettings
  publication: { id: number; createdAt: string } | null
  groups: Array<{ id: number; name: string; anchor: string; documents: DocumentSummary[] }>
}
export interface DocumentDetail extends DocumentSummary {
  html: string
  searchText: string
  outline: Array<{ id: string; text: string; level: number }>
}
export interface SearchResult {
  slug: string
  title: string
  heading: string
  anchor: string
  snippet: string
}
