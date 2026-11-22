import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { buildPriceExport, exportCatalogHash } from './pdf-data.js'
import { renderPricePdf } from './pdf-render.js'
import { PricePdfPool } from './pdf-pool.js'
import { priceCatalog, priceModel } from '../../tests/fixtures/price-export.js'

async function extract(bytes: Buffer) {
  const loading = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false,
    standardFontDataUrl: fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)) })
  const pdf = await loading.promise
  try {
    const pages = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i), content = await page.getTextContent()
      pages.push({ text: content.items.map(item => 'str' in item ? item.str : '').join(' '), content, viewport: page.getViewport({ scale: 1 }) })
    }
    return pages
  } finally { await loading.destroy() }
}

describe('rendered price PDF', () => {
  it('embeds searchable Chinese, accurate rounded prices, missing values and billing conditions', async () => {
    const catalog = priceCatalog()
    const data = buildPriceExport(catalog, { catalogHash: exportCatalogHash(catalog), billing: 'subscription', showRelease: false,
      rows: catalog.groups[0].models.map(m => ({ platform: m.platform, modelId: m.id, groupId: '12' })) }, 'https://docs.ailink1.com')
    const bytes = await renderPricePdf(data)
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    const text = (await extract(bytes)).map(p => p.text).join(' ')
    for (const token of ['模型价格表', 'OpenAI 订阅', '¥0.08', '$1', '0.08x', '¥0', '待确认', '1K', '2K', '4K', '¥0.06', '¥0.10', '272K', 'Fast / Priority', 'Flex', 'AiLink']) expect(text).toContain(token)
    expect(text).not.toContain('0.08001')
    expect(text).not.toContain('0.0798')
    expect(bytes.length).toBeLessThan(500_000)
  }, 20_000)

  it('repeats headers, watermarks and page numbers without clipping long names or changing order', async () => {
    const catalog = priceCatalog()
    catalog.groups[0].models = Array.from({ length: 60 }, (_, i) => priceModel(`test-model-${String(i).padStart(3, '0')}-extended-version-20261105`, { releasedAt: '2026-11-05' }))
    const data = buildPriceExport(catalog, { catalogHash: exportCatalogHash(catalog), billing: 'subscription', showRelease: true,
      rows: catalog.groups[0].models.map(m => ({ platform: m.platform, modelId: m.id, groupId: '12' })) }, 'https://docs.ailink1.com')
    const pages = await extract(await renderPricePdf(data))
    expect(pages.length).toBeGreaterThan(2)
    for (const [i, page] of pages.entries()) {
      if (page.text.includes('test-model-')) { expect(page.text).toContain('输入'); expect(page.text).toContain('发布日期') }
      else expect(page.text).toContain('计费说明')
      expect(page.text.match(/AiLink/g)?.length).toBeGreaterThanOrEqual(2)
      expect(page.text).toContain(`${i + 1} / ${pages.length}`)
      for (const item of page.content.items) if ('str' in item && item.str && item.str !== 'AiLink') {
        expect(item.transform[4]).toBeGreaterThanOrEqual(30)
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(page.viewport.width - 29)
      }
    }
    const text = pages.map(p => p.text).join(' ')
    for (let i = 1; i < 60; i++) expect(text.indexOf(`test-model-${String(i).padStart(3, '0')}`)).toBeGreaterThan(text.indexOf(`test-model-${String(i - 1).padStart(3, '0')}`))
  }, 20_000)

  it('generates through the worker and preserves CNY reference currency in balance mode', async () => {
    const catalog = priceCatalog(), worker = new PricePdfPool()
    const data = buildPriceExport(catalog, { catalogHash: exportCatalogHash(catalog), billing: 'balance', showRelease: false,
      rows: [{ platform: 'deepseek', modelId: 'deepseek-test', groupId: '114' }] }, 'https://docs.ailink1.com')
    try {
      const text = (await extract(await worker.generate(data))).map(p => p.text).join(' ')
      expect(text).toContain('¥1.8'); expect(text).toContain('¥9'); expect(text).not.toContain('$9')
      expect(text).toContain('DeepSeek 余额')
    } finally { await worker.close() }
  }, 20_000)

  it('uses resolution headers for image-only exports and bounds concurrent work', async () => {
    const catalog = priceCatalog(), worker = new PricePdfPool()
    const data = buildPriceExport(catalog, { catalogHash: exportCatalogHash(catalog), billing: 'subscription', showRelease: false,
      rows: [{ platform: 'openai', modelId: 'image-test', groupId: '12' }] }, 'https://docs.ailink1.com')
    try {
      const jobs = await Promise.allSettled(Array.from({ length: 6 }, () => worker.generate(data)))
      expect(jobs.filter(job => job.status === 'fulfilled')).toHaveLength(5)
      expect(jobs[5]).toMatchObject({ status: 'rejected', reason: { statusCode: 503 } })
      const first = jobs[0]
      if (first.status !== 'fulfilled') throw first.reason
      const text = (await extract(first.value)).map(p => p.text).join(' ')
      expect(text).toContain('1K · 每张'); expect(text).toContain('2K · 每张'); expect(text).toContain('4K · 每张')
      expect(text).not.toContain('1M token'); expect(text).not.toContain('缓存命中')
    } finally { await worker.close() }
  }, 20_000)
  it('separates provider and model columns in an all-model price sheet', async () => {
    const catalog = priceCatalog()
    const data = buildPriceExport(catalog, { catalogHash: exportCatalogHash(catalog), billing: 'balance', showRelease: true, showPlatform: true,
      rows: [{ platform: 'deepseek', modelId: 'deepseek-test', groupId: '114' }, { platform: 'openai', modelId: 'gpt-test', groupId: '26' }] }, 'https://docs.ailink1.com')
    const [page] = await extract(await renderPricePdf(data))
    expect(page.text).toContain('平台'); expect(page.text).toContain('模型 ID')
    expect(page.text).toContain('DeepSeek'); expect(page.text).toContain('deepseek-test')
    expect(page.text.indexOf('deepseek-test')).toBeLessThan(page.text.indexOf('gpt-test'))
  }, 20_000)
})
