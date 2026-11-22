import sanitizeHtml from 'sanitize-html'

export const plainText = (html: string) => sanitizeHtml(html.replace(/<button\b[^>]*>[\s\S]*?<\/button>/g, ''), { allowedTags: [], allowedAttributes: {} })
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()

export function documentMetadata(html: string) {
  const first = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? ''
  const summary = plainText(first).slice(0, 180)
  const outline = [...html.matchAll(/<h([23])\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/h[23]>/g)]
    .map((match) => ({ id: match[2], text: plainText(match[3]), level: Number(match[1]) }))
  return { summary, outline, readingMinutes: Math.max(1, Math.ceil(plainText(html).length / 500)) }
}

export function addImageDimensions(html: string, dimensions: Map<string, { width: number | null; height: number | null }>) {
  let firstImage = true
  return html.replace(/<img\b[^>]*>/g, (tag) => {
    const src = tag.match(/\bsrc="([^"]+)"/)?.[1]
    const size = src ? dimensions.get(src) : undefined
    if (size?.width && size.height && !/\bwidth=/.test(tag)) tag = tag.replace(/\s*\/?\s*>$/, ` width="${size.width}" height="${size.height}" />`)
    if (firstImage) { tag = tag.replace('loading="lazy"', 'loading="eager"'); firstImage = false }
    return tag
  })
}

export interface SearchableDocument {
  slug: string; title: string; navLabel: string; summary: string; html: string; searchText: string
  outline: Array<{ id: string; text: string; level: number }>
}

export function searchDocuments(documents: SearchableDocument[], query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return documents.flatMap((doc) => {
    const title = `${doc.title} ${doc.navLabel}`.toLocaleLowerCase()
    const body = doc.searchText.toLocaleLowerCase()
    if (!terms.every((term) => `${title} ${body}`.includes(term))) return []
    const headingMatch = doc.outline.find((item) => terms.some((term) => item.text.toLocaleLowerCase().includes(term)))
    // A body-text match should land in its section, not at the top of a long guide.
    const sections = [...doc.html.matchAll(/<h[23]\b[^>]*id="([^"]+)"[^>]*>[\s\S]*?<\/h[23]>([\s\S]*?)(?=<h[23]\b|$)/g)]
    const section = sections.find((match) => terms.some((term) => plainText(match[2]).toLocaleLowerCase().includes(term)))
    const heading = headingMatch ?? doc.outline.find((item) => item.id === section?.[1])
    const score = terms.reduce((n, term) => n + (title.includes(term) ? 100 : 0) + (heading?.text.toLocaleLowerCase().includes(term) ? 30 : 0), 1)
    const snippetText = section && !headingMatch ? plainText(section[2]) : doc.searchText
    const index = snippetText.toLocaleLowerCase().indexOf(terms.find((term) => snippetText.toLocaleLowerCase().includes(term)) ?? terms[0])
    const start = Math.max(0, index - 35)
    return [{ slug: doc.slug, title: doc.title, heading: heading?.text ?? '', anchor: heading?.id ?? '',
      snippet: (start ? '…' : '') + snippetText.slice(start, start + 150) + (start + 150 < snippetText.length ? '…' : ''), score }]
  }).sort((a, b) => b.score - a.score).slice(0, 12).map(({ score: _score, ...item }) => item)
}
