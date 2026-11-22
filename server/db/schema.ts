import {
  bigint,
  boolean,
  datetime,
  int,
  longtext,
  mysqlTable,
  primaryKey,
  text,
  varchar
} from 'drizzle-orm/mysql-core'

const timestamps = {
  createdAt: datetime('created_at', { mode: 'date' }).notNull().default(new Date()),
  updatedAt: datetime('updated_at', { mode: 'date' }).notNull().default(new Date())
}

export const adminUsers = mysqlTable('admin_users', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  username: varchar('username', { length: 80 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  ...timestamps
})

export const adminSessions = mysqlTable('admin_sessions', {
  tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
  userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull(),
  expiresAt: datetime('expires_at', { mode: 'date' }).notNull(),
  createdAt: datetime('created_at', { mode: 'date' }).notNull().default(new Date())
})

export const siteSettings = mysqlTable('site_settings', {
  id: int('id').primaryKey(),
  siteName: varchar('site_name', { length: 120 }).notNull(),
  subtitle: varchar('subtitle', { length: 255 }).notNull(),
  consoleUrl: varchar('console_url', { length: 500 }).notNull(),
  accentColor: varchar('accent_color', { length: 20 }).notNull(),
  ...timestamps
})

export const navGroups = mysqlTable('nav_groups', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  anchor: varchar('anchor', { length: 160 }).notNull().unique(),
  sortOrder: int('sort_order').notNull().default(0),
  isVisible: boolean('is_visible').notNull().default(true),
  ...timestamps
})

export const documents = mysqlTable('documents', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  groupId: bigint('group_id', { mode: 'number', unsigned: true }).notNull(),
  title: varchar('title', { length: 180 }).notNull(),
  navLabel: varchar('nav_label', { length: 120 }).notNull(),
  slug: varchar('slug', { length: 180 }).notNull().unique(),
  markdown: longtext('markdown').notNull(),
  sortOrder: int('sort_order').notNull().default(0),
  isVisible: boolean('is_visible').notNull().default(true),
  ...timestamps
})

export const mediaAssets = mysqlTable('media_assets', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  storageName: varchar('storage_name', { length: 255 }).notNull().unique(),
  originalName: varchar('original_name', { length: 255 }).notNull(),
  mime: varchar('mime', { length: 80 }).notNull(),
  byteSize: bigint('byte_size', { mode: 'number', unsigned: true }).notNull(),
  width: int('width'),
  height: int('height'),
  urlPath: varchar('url_path', { length: 500 }).notNull(),
  createdBy: bigint('created_by', { mode: 'number', unsigned: true }).notNull(),
  createdAt: datetime('created_at', { mode: 'date' }).notNull().default(new Date())
})

export const publications = mysqlTable('publications', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  siteName: varchar('site_name', { length: 120 }).notNull(),
  subtitle: varchar('subtitle', { length: 255 }).notNull(),
  consoleUrl: varchar('console_url', { length: 500 }).notNull(),
  accentColor: varchar('accent_color', { length: 20 }).notNull(),
  documentCount: int('document_count').notNull().default(0),
  createdBy: bigint('created_by', { mode: 'number', unsigned: true }).notNull(),
  createdAt: datetime('created_at', { mode: 'date' }).notNull().default(new Date())
})

export const publicationGroups = mysqlTable('publication_groups', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  publicationId: bigint('publication_id', { mode: 'number', unsigned: true }).notNull(),
  sourceGroupId: bigint('source_group_id', { mode: 'number', unsigned: true }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  anchor: varchar('anchor', { length: 160 }).notNull(),
  sortOrder: int('sort_order').notNull()
})

export const publicationDocuments = mysqlTable('publication_documents', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  publicationId: bigint('publication_id', { mode: 'number', unsigned: true }).notNull(),
  publicationGroupId: bigint('publication_group_id', { mode: 'number', unsigned: true }).notNull(),
  sourceDocumentId: bigint('source_document_id', { mode: 'number', unsigned: true }).notNull(),
  title: varchar('title', { length: 180 }).notNull(),
  navLabel: varchar('nav_label', { length: 120 }).notNull(),
  slug: varchar('slug', { length: 180 }).notNull(),
  markdown: longtext('markdown').notNull(),
  renderedHtml: longtext('rendered_html').notNull(),
  searchText: longtext('search_text').notNull(),
  contentUpdatedAt: datetime('content_updated_at', { mode: 'date' }),
  sortOrder: int('sort_order').notNull()
})

export const siteState = mysqlTable('site_state', {
  id: int('id').primaryKey(),
  activePublicationId: bigint('active_publication_id', { mode: 'number', unsigned: true }),
  updatedAt: datetime('updated_at', { mode: 'date' }).notNull().default(new Date())
})

export const auditLogs = mysqlTable('audit_logs', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  adminId: bigint('admin_id', { mode: 'number', unsigned: true }).notNull(),
  action: varchar('action', { length: 100 }).notNull(),
  targetType: varchar('target_type', { length: 80 }).notNull(),
  targetId: varchar('target_id', { length: 80 }),
  details: text('details'),
  createdAt: datetime('created_at', { mode: 'date' }).notNull().default(new Date())
})

export const schemaMigrations = mysqlTable('schema_migrations', {
  version: int('version').notNull(),
  appliedAt: datetime('applied_at', { mode: 'date' }).notNull().default(new Date())
}, (table) => [primaryKey({ columns: [table.version] })])
