import { parentPort } from 'node:worker_threads'
import { renderPricePdf } from './pdf-render.js'
import type { PriceExportData } from './pdf-data.js'

parentPort!.on('message', async (data: PriceExportData) => {
  try {
    const pdf = await renderPricePdf(data)
    const bytes = Uint8Array.from(pdf)
    parentPort!.postMessage({ bytes }, [bytes.buffer])
  } catch {
    parentPort!.postMessage({ error: 'PDF 生成失败，请稍后重试。' })
  }
})
