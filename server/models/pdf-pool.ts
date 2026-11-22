import { Worker } from 'node:worker_threads'
import type { PriceExportData } from './pdf-data.js'

interface Job { data: PriceExportData; resolve: (pdf: Buffer) => void; reject: (error: Error) => void }
const unavailable = () => Object.assign(new Error('PDF 生成失败，请稍后重试。'), { statusCode: 503 })

// One lazily started worker; neither font parsing nor PDF layout blocks page requests.
export class PricePdfPool {
  private worker: Worker | undefined
  private active: Job | undefined
  private queue: Job[] = []
  private timeout: ReturnType<typeof setTimeout> | undefined
  private closed = false

  generate(data: PriceExportData): Promise<Buffer> {
    if (this.closed) return Promise.reject(unavailable())
    if (this.active && this.queue.length >= 4) return Promise.reject(Object.assign(new Error('导出较繁忙，请稍后重试。'), { statusCode: 503 }))
    return new Promise((resolve, reject) => { this.queue.push({ data, resolve, reject }); this.next() })
  }

  private next() {
    if (this.closed || this.active || !this.queue.length) return
    this.active = this.queue.shift()!
    try {
      if (!this.worker) {
        const source = import.meta.url.endsWith('.ts')
        const url = new URL(source ? './pdf-worker.ts' : './pdf-worker.js', import.meta.url)
        this.worker = source
          ? new Worker(`require('tsx/cjs'); require(${JSON.stringify(url.pathname)})`, { eval: true, execArgv: [] })
          : new Worker(url, { execArgv: [] })
        const worker = this.worker
        worker.on('message', (result: { bytes?: Uint8Array; error?: string }) => {
          if (worker !== this.worker) return
          const job = this.active; this.active = undefined; clearTimeout(this.timeout)
          if (result.bytes) job?.resolve(Buffer.from(result.bytes)); else job?.reject(unavailable())
          worker.unref(); this.next()
        })
        worker.on('error', () => this.failed(worker))
        worker.on('exit', () => this.failed(worker))
      }
      this.worker.ref()
      const worker = this.worker
      this.timeout = setTimeout(() => this.failed(worker), 30_000)
      this.worker.postMessage(this.active.data)
    } catch { this.failed(this.worker) }
  }

  private failed(worker: Worker | undefined) {
    if (worker !== this.worker) return
    this.worker = undefined; clearTimeout(this.timeout)
    this.active?.reject(unavailable()); this.active = undefined
    if (worker) void worker.terminate()
    this.next()
  }

  async close() {
    this.closed = true; clearTimeout(this.timeout)
    this.active?.reject(unavailable()); this.active = undefined
    this.queue.splice(0).forEach(job => job.reject(unavailable()))
    const worker = this.worker; this.worker = undefined
    if (worker) await worker.terminate()
  }
}
