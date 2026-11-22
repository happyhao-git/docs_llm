import { describe, expect, it, vi } from 'vitest'
import { DocumentCache, type DocumentResponse } from './document-cache'

const response = (slug = 'guide', version = 1) => ({ publication: { id: version, createdAt: '' }, document: { slug, title: slug } }) as DocumentResponse
const json = (payload: DocumentResponse, status = 200) => new Response(JSON.stringify(payload), { status })

describe('published document cache', () => {
  it('shares pending prefetches with clicks and serves return visits without another request', async () => {
    let resolve!: (response: Response) => void
    const fetcher = vi.fn(() => new Promise<Response>(done => { resolve = done }))
    const cache = new DocumentCache(fetcher)
    cache.setPublication(1)
    const prefetch = cache.load('guide')
    const click = cache.load('guide')
    expect(fetcher).toHaveBeenCalledTimes(1)
    resolve(json(response()))
    expect(await prefetch).toEqual(await click)
    expect(await cache.load('guide')).toEqual(response())
    expect(fetcher).toHaveBeenCalledTimes(1)
    cache.dispose()
  })

  it('invalidates cached content on publication changes and ignores older in-flight responses', async () => {
    let finishOld!: (response: Response) => void
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { finishOld = done }))
      .mockResolvedValueOnce(json(response('guide', 2)))
    const cache = new DocumentCache(fetcher)
    cache.setPublication(1)
    const old = cache.load('guide')
    cache.setPublication(2)
    const fresh = await cache.load('guide')
    finishOld(json(response('guide', 1)))
    await old
    expect(cache.peek('guide')).toEqual(fresh)
    cache.setPublication(3)
    expect(cache.peek('guide')).toBeUndefined()
    cache.dispose()
  })

  it('does not cache errors or missing documents, and allows a later retry', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(json({ publication: { id: 1, createdAt: '' } }, 404))
      .mockResolvedValueOnce(json(response()))
    const cache = new DocumentCache(fetcher)
    cache.setPublication(1)
    await expect(cache.load('guide')).rejects.toThrow()
    expect(cache.peek('guide')).toBeUndefined()
    expect((await cache.load('guide')).document).toBeUndefined()
    expect(cache.peek('guide')).toBeUndefined()
    expect((await cache.load('guide')).document?.slug).toBe('guide')
    cache.dispose()
  })

  it('bounds memory, keeps recently read articles, and encodes document names', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => json(response(decodeURIComponent(String(url).split('/').pop()!))))
    const cache = new DocumentCache(fetcher, 2)
    cache.setPublication(1)
    await cache.load('中文教程')
    await cache.load('second')
    cache.peek('中文教程')
    await cache.load('third')
    expect(cache.peek('second')).toBeUndefined()
    expect(cache.peek('中文教程')).toBeDefined()
    expect(fetcher.mock.calls[0][0]).toBe('/api/public/documents/%E4%B8%AD%E6%96%87%E6%95%99%E7%A8%8B')
    cache.dispose()
  })
})
