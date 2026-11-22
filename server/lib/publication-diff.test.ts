import { describe, expect, it } from 'vitest'
import { comparePublications, documentUpdateTime, type SiteSnapshot } from './publication-diff.js'

const snapshot = (): SiteSnapshot => ({
  settings: { siteName: 'LinkAPI', subtitle: '文档', consoleUrl: 'https://example.com', accentColor: '#6d4aff' },
  groups: [{ id: 1, name: '教程', anchor: 'guides', documents: [
    { id: 1, title: '安装', navLabel: '安装', slug: 'install', markdown: '# 安装' },
    { id: 2, title: '配置', navLabel: '配置', slug: 'config', markdown: '# 配置' }
  ] }]
})

describe('publication comparison', () => {
  it('does not publish identical content or a change that was reverted', () => {
    const previous = snapshot()
    const current = snapshot()
    current.groups[0].documents[0].markdown += '\n编辑'
    expect(comparePublications(current, previous).updated).toEqual([{ id: 1, title: '安装' }])
    current.groups[0].documents[0].markdown = previous.groups[0].documents[0].markdown
    expect(comparePublications(current, previous).hasChanges).toBe(false)
  })

  it('distinguishes added, edited and removed documents', () => {
    const current = snapshot()
    current.groups[0].documents[0].title = '安装指南'
    current.groups[0].documents[1].id = 3
    const result = comparePublications(current, snapshot())
    expect(result.added.map((doc) => doc.id)).toEqual([3])
    expect(result.updated.map((doc) => doc.id)).toEqual([1])
    expect(result.removed.map((doc) => doc.id)).toEqual([2])
  })

  it('publishes navigation and settings changes without marking articles as edited', () => {
    const current = snapshot()
    current.groups[0].documents.reverse()
    current.settings.subtitle = '新副标题'
    const result = comparePublications(current, snapshot())
    expect(result).toMatchObject({ hasChanges: true, navigationChanged: true, settingsChanged: true, updated: [] })
  })

  it('allows an initial empty publication and removal of all visible content', () => {
    const current = snapshot()
    current.groups = []
    expect(comparePublications(current, null)).toMatchObject({ hasChanges: true, isFirstPublication: true, documentCount: 0 })
    expect(comparePublications(current, snapshot()).removed).toHaveLength(2)
  })

  it('preserves article dates and falls back to the old version date for legacy data', () => {
    const doc = snapshot().groups[0].documents[0]
    const oldDate = new Date('2026-01-01')
    const now = new Date('2026-11-03')
    expect(documentUpdateTime(doc, { ...doc, contentUpdatedAt: oldDate }, now, now)).toEqual(oldDate)
    expect(documentUpdateTime(doc, { ...doc, contentUpdatedAt: null }, oldDate, now)).toEqual(oldDate)
    expect(documentUpdateTime({ ...doc, markdown: '新内容' }, { ...doc, contentUpdatedAt: oldDate }, oldDate, now)).toEqual(now)
  })
})
