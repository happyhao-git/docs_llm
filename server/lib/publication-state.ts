import { asc, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { documents, navGroups, publicationDocuments, publicationGroups, publications, siteSettings, siteState } from '../db/schema.js'
import { comparePublications, type SiteSnapshot } from './publication-diff.js'

type Reader = Pick<typeof db, 'select'>

export async function readPublicationState(reader: Reader = db) {
  const [state] = await reader.select().from(siteState).where(eq(siteState.id, 1)).limit(1)
  const [settings] = await reader.select().from(siteSettings).where(eq(siteSettings.id, 1)).limit(1)
  const groups = await reader.select().from(navGroups).orderBy(asc(navGroups.sortOrder), asc(navGroups.id))
  const docs = await reader.select().from(documents).orderBy(asc(documents.sortOrder), asc(documents.id))
  const activePublicationId = state?.activePublicationId ?? null
  const [previousPublication] = activePublicationId
    ? await reader.select().from(publications).where(eq(publications.id, activePublicationId)).limit(1) : []
  const previousGroups = activePublicationId
    ? await reader.select().from(publicationGroups).where(eq(publicationGroups.publicationId, activePublicationId))
      .orderBy(asc(publicationGroups.sortOrder), asc(publicationGroups.id)) : []
  const previousDocs = activePublicationId
    ? await reader.select().from(publicationDocuments).where(eq(publicationDocuments.publicationId, activePublicationId))
      .orderBy(asc(publicationDocuments.sortOrder), asc(publicationDocuments.id)) : []
  const pickSettings = (value: SiteSnapshot['settings']) => ({
    siteName: value.siteName, subtitle: value.subtitle, consoleUrl: value.consoleUrl, accentColor: value.accentColor
  })
  const snapshot: SiteSnapshot = {
    settings: pickSettings(settings),
    groups: groups.filter((group) => group.isVisible).map((group) => ({
      id: group.id, name: group.name, anchor: group.anchor,
      documents: docs.filter((doc) => doc.groupId === group.id && doc.isVisible).map((doc) => ({
        id: doc.id, title: doc.title, navLabel: doc.navLabel, slug: doc.slug, markdown: doc.markdown
      }))
    }))
  }
  const previousSnapshot: SiteSnapshot | null = previousPublication ? {
    settings: pickSettings(previousPublication),
    groups: previousGroups.map((group) => ({
      id: group.sourceGroupId, name: group.name, anchor: group.anchor,
      documents: previousDocs.filter((doc) => doc.publicationGroupId === group.id).map((doc) => ({
        id: doc.sourceDocumentId, title: doc.title, navLabel: doc.navLabel, slug: doc.slug, markdown: doc.markdown
      }))
    }))
  } : null
  return {
    settings, groups, docs, snapshot, previousPublication, previousDocs,
    status: { activePublicationId, changes: comparePublications(snapshot, previousSnapshot) }
  }
}
