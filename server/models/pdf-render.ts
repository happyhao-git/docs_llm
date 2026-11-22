import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import PdfPrinter from 'pdfmake'
import type { Content, ContentStack, ContentText, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces.js'
import { buildPriceComparison } from './comparison.js'
import { formatAmount, formatCoefficient, formatPriceAmount, formatUnit, hasResolutionPricing, IMAGE_RESOLUTIONS, kindNames } from './presentation.js'
import { PLATFORM_NAMES, type BillingMode, type PriceItem } from './types.js'
import type { PriceExportData, PriceExportRow } from './pdf-data.js'

const accent = '#754BF5', ink = '#232137', muted = '#787589', line = '#E8E5EF'
const asset = (name: string) => fileURLToPath(new URL(`../assets/pdf/${name}`, import.meta.url))
const logo = existsSync(asset('ailink.png')) ? asset('ailink.png') : fileURLToPath(new URL('../../public/icon-192.png', import.meta.url))
const printer = new PdfPrinter({ Noto: { normal: asset('NotoSansSC-Regular.otf'), bold: asset('NotoSansSC-Bold.otf'),
  italics: asset('NotoSansSC-Regular.otf'), bolditalics: asset('NotoSansSC-Bold.otf') },
  Latin: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' } })
const date = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
const small = (text: string): ContentText => ({ text, fontSize: 7.5, color: muted, margin: [0, 3, 0, 0] })

function price(item: PriceItem | undefined, mode: BillingMode, image = false): ContentText {
  const text: ContentText[] = [item?.final != null
    ? { text: `¥${formatPriceAmount(item, mode, image ? 'cents' : 'default')}`, font: 'Latin', bold: true, color: ink, fontSize: 10 }
    : { text: item ? '待确认' : '—', color: muted }]
  if (item?.official != null) text.push({ text: ' / ', color: '#B5B1C0', fontSize: 8 },
    { text: `${item.officialCurrency === 'CNY' ? '¥' : '$'}${formatAmount(item.official, true)}`, font: 'Latin', decoration: 'lineThrough', color: muted, fontSize: 8 })
  return { text, margin: [0, 2, 0, 0] }
}

function billingNote(row: PriceExportRow): string | null {
  if (!row.group || !row.model.items.some(i => i.condition)) return null
  const comparison = buildPriceComparison(row.model.items)
  const scope = comparison.standard?.context
  const special = [...new Set(comparison.columns.filter(c => c.kind !== 'standard').map(c => c.label))].join('、')
  return `${scope ? `${scope}（含缓存）适用标准价。` : '表中为标准计费价格。'}${special}另计，点击模型名称查看详情。`
}

export function priceDocument(data: PriceExportData): TDocumentDefinitions {
  const notes: string[] = []
  const imagesOnly = data.rows.every(row => row.group ? hasResolutionPricing(row.model) : row.model.kind === 'image')
  const specialOnly = !imagesOnly && data.rows.every(row => !['text', 'embedding'].includes(row.model.kind))
  const hasOfficial = data.rows.some(row => row.model.items.some(item => item.official != null))
  const head = (title: string, subtitle = ''): ContentStack & { fillColor: string } => ({ stack: [
    { text: title, fontSize: 8.5, color: ink }, ...(subtitle ? [small(subtitle)] : [])
  ], fillColor: '#F4F1FB' })
  const pricesHeading = hasOfficial ? '实际价格 / 官方价格' : '实际价格'
  const priceHeaders: TableCell[] = imagesOnly ? IMAGE_RESOLUTIONS.map(size => head(`${size.toUpperCase()} · 每张`, pricesHeading))
    : specialOnly ? [{ ...head('计费项目', pricesHeading), colSpan: 3 }, {}, {}]
      : ['输入', '输出', '缓存命中'].map(t => head(`${t} · 1M token`, pricesHeading))
  const headers: TableCell[] = [...(data.showPlatform ? [head('平台')] : []), head(data.showPlatform ? '模型 ID' : '模型 / 厂商'), ...priceHeaders, head('使用分组 / 倍率')]
  if (data.showRelease) headers.push(head('发布日期'))
  const body: TableCell[][] = [headers]
  for (const row of data.rows) {
    const { model, group } = row, image = hasResolutionPricing(model)
    const note = billingNote(row)
    if (note && !notes.includes(note)) notes.push(note)
    const url = new URL('/models', data.origin)
    url.searchParams.set('platform', model.platform); url.searchParams.set('billing', data.billing); url.searchParams.set('q', model.id)
    if (group) url.searchParams.set('group', group.id)
    const identity: TableCell = { stack: [
      { text: model.id, link: url.href, fontSize: 9, font: /^[\x20-\x7e]+$/.test(model.id) ? 'Latin' : 'Noto', bold: /^[\x20-\x7e]+$/.test(model.id), color: ink },
      small(`${data.showPlatform ? '' : `${PLATFORM_NAMES[model.platform] || model.platform} · `}${kindNames[model.kind] || model.kind}${note ? `  [${notes.indexOf(note) + 1}]` : ''}`)
    ] }
    const cells: TableCell[] = [...(data.showPlatform ? [{ text: PLATFORM_NAMES[model.platform] || model.platform, fontSize: 8.5, margin: [0, 2, 0, 0] } as TableCell] : []), identity]
    if (!group) cells.push({ text: data.billing === 'subscription' ? '暂无订阅报价' : '暂无余额报价', color: muted, colSpan: 3, margin: [0, 4, 0, 0] }, {}, {})
    else if (imagesOnly) {
      cells.push(...IMAGE_RESOLUTIONS.map(size => price(model.items.find(i => i.key === `image-${size}` && !i.condition), data.billing, true)))
    } else if (['text', 'embedding'].includes(model.kind)) {
      cells.push(...['input', 'output', 'cacheRead'].map(key => price(model.items.find(i => i.key === key && !i.condition), data.billing)))
    } else {
      const items = image ? IMAGE_RESOLUTIONS.map(size => model.items.find(i => i.key === `image-${size}` && !i.condition))
        : model.items.filter(i => !i.condition && i.final != null).slice(0, 3)
      const columns: Content[] = items.map((item, i) => ({ stack: [
        small(image ? `${IMAGE_RESOLUTIONS[i].toUpperCase()} · 每张` : `${item?.label || ''} · ${formatUnit(item?.unit || '')}`),
        price(item, data.billing, image)
      ] }))
      cells.push({ colSpan: 3, ...(columns.length ? { columns, columnGap: 12 } : { text: '待确认', color: muted }) }, {}, {})
    }
    const item = model.items[0]
    cells.push({ stack: [{ text: group?.name || '—', fontSize: 8.5 }, ...(group && item ? [small(image
      ? `图片倍率 ${formatCoefficient(item.rate)}` : `折算倍率 ${formatCoefficient(item.coefficient, data.billing)}`)] : [])] })
    if (data.showRelease) cells.push({ text: model.releasedAt || '—', fontSize: 8, color: muted })
    body.push(cells)
  }
  const content: Content[] = [{
    text: `实际价格为人民币（CNY）。${hasOfficial ? '官方价格以 ¥（CNY）或 $（USD）标示。' : ''}${data.billing === 'subscription' ? '订阅价格按额度全部使用折算。' : ''}${data.rows.some(row => row.model.kind === 'image') ? '图片按张计费。' : ''}`,
    fontSize: 7.5, color: muted, margin: [0, 0, 0, 9]
  }, { table: {
    headerRows: 1, dontBreakRows: true,
    widths: data.showPlatform
      ? data.showRelease ? [58, 159, '*', '*', '*', 106, 55] : [64, 186, '*', '*', '*', 116]
      : data.showRelease ? [188, '*', '*', '*', 115, 57] : [222, '*', '*', '*', 132], body
  }, layout: {
    hLineWidth: (i: number) => i === 1 ? 1 : 0.45, vLineWidth: () => 0,
    hLineColor: () => line, paddingLeft: () => 9, paddingRight: () => 9,
    paddingTop: () => 6, paddingBottom: () => 6
  } }, ...(notes.length ? [{ text: '计费说明', fontSize: 9, color: ink, margin: [0, 12, 0, 3] } as Content] : []),
    ...notes.map((note, index): Content => ({ text: `[${index + 1}] ${note}`, fontSize: 7.5, color: muted, margin: [0, 4, 0, 0] }))]
  return {
    pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [32, 91, 32, 42],
    defaultStyle: { font: 'Noto', fontSize: 9, color: ink, lineHeight: 1.12 },
    info: { title: `AiLink 模型价格表 · ${data.billing === 'subscription' ? '订阅' : '余额'}`, author: 'AiLink', creator: 'AiLink', subject: '模型价格表' },
    watermark: { text: 'AiLink', font: 'Latin', color: accent, opacity: 0.055, angle: -25, fontSize: 112, bold: true },
    header: () => ({ margin: [32, 23, 32, 0], stack: [
      { columns: [{ image: logo, width: 27 }, { text: [{ text: 'AiLink', font: 'Latin', bold: true, fontSize: 17 }, { text: '  /  模型价格表', fontSize: 12, color: muted }], margin: [9, 1, 0, 0] },
        { text: `${data.billing === 'subscription' ? '订阅' : '余额'} · ${data.rows.length} 个模型`, alignment: 'right', color: accent, fontSize: 10, margin: [0, 5, 0, 0] }] },
      { text: `价格更新 ${date(data.updatedAt)}  ·  生成 ${date(data.generatedAt)}（北京时间）`, color: muted, fontSize: 7.5, margin: [0, 8, 0, 0] },
      { canvas: [{ type: 'line', x1: 0, y1: 9, x2: 777.89, y2: 9, lineWidth: 0.7, lineColor: line }] }
    ] }),
    footer: (currentPage, pageCount) => ({ columns: [
      { text: `${new URL(data.origin).host}/models`, link: `${data.origin}/models`, color: muted, fontSize: 7.5 },
      { text: `${currentPage} / ${pageCount}`, alignment: 'right', color: muted, fontSize: 7.5 }
    ], margin: [32, 15, 32, 0] }),
    content
  }
}

export function renderPricePdf(data: PriceExportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = printer.createPdfKitDocument(priceDocument(data)), chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('error', reject)
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.end()
    } catch (error) { reject(error) }
  })
}
