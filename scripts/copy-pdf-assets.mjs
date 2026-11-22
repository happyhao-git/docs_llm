import { cp, mkdir, copyFile } from 'node:fs/promises'

const target = new URL('../dist/server/assets/pdf/', import.meta.url)
await mkdir(target, { recursive: true })
await cp(new URL('../server/assets/pdf/', import.meta.url), target, { recursive: true })
await copyFile(new URL('../public/icon-192.png', import.meta.url), new URL('linkapi.png', target))
