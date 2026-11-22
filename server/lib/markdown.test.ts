import { describe, expect, it } from 'vitest'
import { prefixDocumentIds, renderMarkdown } from './markdown.js'

describe('renderMarkdown', () => {
  it('sanitizes scripts and unsafe links', () => {
    const result = renderMarkdown('[危险](javascript:alert(1))\n\n<script>alert(1)</script>')
    expect(result.html).not.toContain('href="javascript:')
    expect(result.html).not.toContain('<script>')
  })

  it('opens regular links in a new tab but keeps anchors local', () => {
    const result = renderMarkdown('[控制台](https://ai.gs88.shop) [标题](#title)')
    expect(result.html).toContain('target="_blank"')
    expect(result.html).toContain('rel="noopener noreferrer"')
    expect(result.html).toContain('href="#title"')
  })

  it('renders copyable code blocks and tabs', () => {
    const result = renderMarkdown(':::tabs\n:::tab cURL\n```bash\ncurl https://example.com\n```\n:::tab Node.js\n```js\nfetch("https://example.com")\n```\n:::\n![截图](https://example.com/image.png)')
    expect(result.html).toContain('class="doc-tabs"')
    expect(result.html).toContain('data-copy-code')
    expect(result.html).toContain('data-tab-target="tabs-0-1"')
    expect(result.html).not.toContain('DOCSTABSBLOCK')
    expect(result.html).toContain('class="doc-image"')
  })

  it('prefixes generated ids per document', () => {
    const result = renderMarkdown('## 配置')
    expect(prefixDocumentIds(result.html, 'quick-start')).toContain('id="quick-start--配置"')
  })
})

describe('structured tutorial content', () => {
  it('renders support, disclosures and restricted legacy anchors', () => {
    const { html } = renderMarkdown('<!-- anchors: old-heading | 旧章节 -->\n\n::: support 需要帮助？\n扫码联系\n\n![二维码](/uploads/qr.png)\n:::\n\n::: details 更多步骤\n## 高级配置\n说明\n:::')
    expect(html).toContain('class="support-card"')
    expect(html).toContain('<details class="doc-details"><summary>更多步骤</summary>')
    expect(html).toContain('id="old-heading"')
    expect(html).toContain('id="旧章节"')
    expect(html).toContain('loading="lazy"')
    expect(renderMarkdown('<!-- anchors: x" onclick="alert(1) -->').html).not.toContain('<span')
  })
  it('keeps container and anchor examples literal inside code fences', () => {
    const source = '```text\n:::tabs\n:::tab A\n<!-- anchors: sample -->\n::: details Example\n::: support Help\n::: \n```'
    const {html} = renderMarkdown(source)
    expect(html).not.toContain('class="doc-tabs"')
    expect(html).not.toContain('<details')
    expect(html).not.toContain('id="sample"')
    expect(html).toContain(':::tabs')
  })
  it('preserves long code in the DOM while offering a collapsed view', () => {
    const code = Array.from({length:30},(_,i)=>`line-${i}`).join('\n')
    const {html} = renderMarkdown('```text\n'+code+'\n```')
    expect(html).toContain('is-collapsed')
    expect(html).toContain('data-code-toggle')
    expect(html).toContain('line-29')
  })
  it('keeps tab relationships unique after document prefixes', () => {
    const result = prefixDocumentIds(renderMarkdown(':::tabs\n:::tab A\n```text\n::: literal\n::: \n```\n:::tab B\nB\n:::').html,'example')
    expect(result).toContain('id="example--tabs-0-0"')
    expect(result).toContain('aria-controls="example--tabs-0-0"')
    expect(result).toContain('aria-labelledby="example--tab-0-0"')
    expect(result).toContain('::: literal')
    expect(result).toContain('example--tabs-0-1')
  })
  it('escapes container titles and keeps documentation links in the same tab', () => {
    const {html} = renderMarkdown('::: support <img src=x onerror=alert(1)>\nHello\n:::\n[guide](/docs/example)')
    expect(html).not.toContain('<img src="x"')
    expect(html).not.toContain('target="_blank"')
  })
})
