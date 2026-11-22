import hljs from 'highlight.js'
import MarkdownIt from 'markdown-it'
import anchor from 'markdown-it-anchor'
import container from 'markdown-it-container'
import taskLists from 'markdown-it-task-lists'
import sanitizeHtml from 'sanitize-html'
import { slugify } from './slug.js'

const escapeHtml = (value: string) => MarkdownIt().utils.escapeHtml(value)

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  highlight(code, language) {
    const normalized = language?.trim().toLowerCase() ?? ''
    let highlighted: string
    try {
      highlighted = normalized && hljs.getLanguage(normalized)
        ? hljs.highlight(code, { language: normalized, ignoreIllegals: true }).value
        : hljs.highlightAuto(code).value
    } catch {
      highlighted = escapeHtml(code)
    }

    const label = normalized ? escapeHtml(normalized) : 'text'
    const long = code.split('\n').length > 20 || code.length > 1600
    return `<div class="code-block${long ? ' is-collapsed' : ''}"><div class="code-header"><span class="code-language">${label}</span><button class="code-copy" type="button" data-copy-code aria-label="复制代码"><i data-lucide="copy"></i><span>复制</span></button></div><pre><code class="hljs${normalized ? ` language-${label}` : ''}">${highlighted}</code></pre>${long ? '<button class="code-expand" type="button" data-code-toggle aria-expanded="false">展开完整内容</button>' : ''}</div>`
  }
})

md.use(anchor, {
  slugify: (value: string) => slugify(value, 'heading'),
  permalink: false
})
md.use(taskLists as never, { enabled: false, label: false })

// Explicit legacy anchors are restricted to a standalone directive, never raw HTML.
md.block.ruler.before('html_block', 'legacy_anchors', (state, startLine, _endLine, silent) => {
  const line = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine])
  const match = line.match(/^<!-- anchors: ([\p{Letter}\p{Number}_| -]+) -->$/u)
  if (!match) return false
  if (!silent) {
    const token = state.push('legacy_anchors', '', 0)
    token.content = match[1]
    state.line = startLine + 1
  }
  return true
})
md.renderer.rules.legacy_anchors = (tokens, index) => tokens[index].content.split('|')
  .map((id) => `<span class="legacy-anchor" id="${escapeHtml(id.trim())}" aria-hidden="true"></span>`).join('')

for (const type of ['support', 'details'] as const) {
  md.use(container as never, type, {
    validate: (params: string) => params.trim().split(/\s+/)[0] === type,
    render: (tokens: Array<{ nesting: number; info: string }>, index: number) => {
      const token = tokens[index]
      if (token.nesting !== 1) return type === 'details' ? '</details>' : '</aside>'
      const title = escapeHtml(token.info.trim().slice(type.length).trim() || (type === 'support' ? '技术支持' : '查看详细说明'))
      return type === 'details' ? `<details class="doc-details"><summary>${title}</summary>`
        : `<aside class="support-card" aria-label="技术支持"><div class="support-title">${title}</div>`
    }
  })
}

for (const type of ['info', 'tip', 'warning', 'danger'] as const) {
  md.use(container as never, type, {
    validate: (params: string) => params.trim().startsWith(type),
    render: (tokens: Array<{ nesting: number; info: string }>, index: number) => {
      const token = tokens[index]
      if (token.nesting === 1) {
        const title = token.info.trim().slice(type.length).trim()
        return `<aside class="callout callout-${type}">${title ? `<div class="callout-title">${escapeHtml(title)}</div>` : ''}`
      }
      return '</aside>'
    }
  })
}

const defaultLinkOpen = md.renderer.rules.link_open
md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const href = tokens[index].attrGet('href') ?? ''
  if (/^https?:\/\//.test(href)) {
    tokens[index].attrSet('target', '_blank')
    tokens[index].attrSet('rel', 'noopener noreferrer')
  }
  return defaultLinkOpen ? defaultLinkOpen(tokens, index, options, env, self) : self.renderToken(tokens, index, options)
}

const defaultImage = md.renderer.rules.image
md.renderer.rules.image = (tokens, index, options, env, self) => {
  tokens[index].attrSet('loading', 'lazy')
  tokens[index].attrSet('decoding', 'async')
  tokens[index].attrJoin('class', 'doc-image')
  return defaultImage ? defaultImage(tokens, index, options, env, self) : self.renderToken(tokens, index, options)
}

type Tab = { label: string; markdown: string }

function extractTabs(source: string) {
  const lines = source.split('\n')
  const output: string[] = []
  const blocks: Tab[][] = []
  let fence = ''

  for (let index = 0; index < lines.length; index += 1) {
    const marker = lines[index].match(/^\s{0,3}(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = ''
      output.push(lines[index])
      continue
    }
    if (fence) { output.push(lines[index]); continue }
    if (lines[index].trim() !== ':::tabs') {
      output.push(lines[index])
      continue
    }

    const tabs: Tab[] = []
    let current: Tab | null = null
    let closed = false
    let tabFence = ''
    let nestedContainer = 0
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index]
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)
      if (marker) {
        if (!tabFence) tabFence = marker[1]
        else if (marker[1][0] === tabFence[0] && marker[1].length >= tabFence.length) tabFence = ''
        if (current) current.markdown += `${current.markdown ? '\n' : ''}${line}`
        continue
      }
      const tabMatch = !tabFence && !nestedContainer ? line.match(/^:::tab\s+(.+)$/) : null
      if (tabMatch) {
        if (current) tabs.push(current)
        current = { label: tabMatch[1].trim(), markdown: '' }
        continue
      }
      if (!tabFence && /^:::\s*\w/.test(line)) nestedContainer++
      if (!tabFence && line.trim() === ':::' && nestedContainer > 0) {
        nestedContainer--
        if (current) current.markdown += `\n${line}`
        continue
      }
      if (!tabFence && line.trim() === ':::') {
        if (current) tabs.push(current)
        closed = true
        break
      }
      if (current) current.markdown += `${current.markdown ? '\n' : ''}${line}`
    }

    if (!closed || tabs.length === 0) {
      output.push(':::tabs')
      for (const tab of tabs) output.push(`:::tab ${tab.label}`, tab.markdown)
      continue
    }

    const blockIndex = blocks.push(tabs) - 1
    output.push('', `DOCSTABSBLOCK${blockIndex}`, '')
  }

  return { markdown: output.join('\n'), blocks }
}

function renderTabBlock(tabs: Tab[], blockIndex: number) {
  const buttons = tabs.map((tab, tabIndex) => (
    `<button id="tab-${blockIndex}-${tabIndex}" class="doc-tab-button${tabIndex === 0 ? ' active' : ''}" type="button" role="tab" tabindex="${tabIndex === 0 ? 0 : -1}" aria-controls="tabs-${blockIndex}-${tabIndex}" aria-selected="${tabIndex === 0}" data-tab-target="tabs-${blockIndex}-${tabIndex}">${escapeHtml(tab.label)}</button>`
  )).join('')
  const panels = tabs.map((tab, tabIndex) => (
    `<div id="tabs-${blockIndex}-${tabIndex}" aria-labelledby="tab-${blockIndex}-${tabIndex}" class="doc-tab-panel${tabIndex === 0 ? ' active' : ''}" role="tabpanel">${md.render(tab.markdown)}</div>`
  )).join('')
  return `<div class="doc-tabs"><div class="doc-tab-list" role="tablist">${buttons}</div>${panels}</div>`
}

const cleanOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    'article', 'aside', 'button', 'div', 'figure', 'figcaption', 'i', 'img',
    'input', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'details', 'summary'
  ],
  allowedAttributes: {
    '*': ['class', 'id', 'role', 'aria-label', 'aria-selected', 'aria-controls', 'aria-labelledby', 'aria-expanded', 'aria-hidden', 'tabindex'],
    a: ['href', 'name', 'target', 'rel'],
    button: ['type', 'data-copy-code', 'data-tab-target', 'data-code-toggle'],
    code: ['class'],
    i: ['data-lucide'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding', 'class'],
    input: ['type', 'checked', 'disabled']
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: {
    img: ['http', 'https']
  },
  allowProtocolRelative: false
}

export function renderMarkdown(source: string) {
  const { markdown, blocks } = extractTabs(source)
  let html = md.render(markdown)
  blocks.forEach((tabs, index) => {
    html = html.replace(new RegExp(`<p>\\s*DOCSTABSBLOCK${index}\\s*</p>`), renderTabBlock(tabs, index))
  })
  const sanitized = sanitizeHtml(html, cleanOptions)
  const searchText = sanitizeHtml(sanitized, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim()

  return { html: sanitized, searchText }
}

export function prefixDocumentIds(html: string, documentSlug: string) {
  const prefix = `${slugify(documentSlug, 'document')}--`
  return html
    .replace(/\bid="([^"]+)"/g, (_match, id: string) => `id="${prefix}${id}"`)
    .replace(/\bdata-tab-target="([^"]+)"/g, (_match, id: string) => `data-tab-target="${prefix}${id}"`)
    .replace(/\b(aria-controls|aria-labelledby)="([^"]+)"/g, (_match, attr: string, id: string) => `${attr}="${prefix}${id}"`)
    .replace(/\bhref="#([^"]+)"/g, (_match, id: string) => `href="#${prefix}${id}"`)
}
