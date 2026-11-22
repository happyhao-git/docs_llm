import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

// Keep browser, bookmark and home-screen icons derived from one vector master.
const publicDir = new URL('../public/', import.meta.url)
const source = await readFile(new URL('favicon.svg', publicDir))
// Full-bleed background for OS-controlled icon masks; the mark stays inside the
// safe center. Browser icons retain the rounded transparent silhouette.
const fullBleed = Buffer.from(source.toString().replace('rx="18"', 'rx="0"'))
await Promise.all([
  [16, 'favicon-16.png', source],
  [32, 'favicon-32.png', source],
  [180, 'apple-touch-icon.png', fullBleed],
  [192, 'icon-192.png', source],
  [512, 'icon-512.png', source],
  [512, 'icon-maskable-512.png', fullBleed]
].map(([size, name, input]) => sharp(input).resize(size, size).png().toFile(new URL(name, publicDir).pathname)))

const sizes = [16, 32, 48]
const images = await Promise.all(sizes.map((size) => sharp(source).resize(size, size).png().toBuffer()))
const header = Buffer.alloc(6 + sizes.length * 16)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)
let offset = header.length
images.forEach((image, index) => {
  const start = 6 + index * 16
  header[start] = sizes[index]
  header[start + 1] = sizes[index]
  header.writeUInt16LE(1, start + 4)
  header.writeUInt16LE(32, start + 6)
  header.writeUInt32LE(image.length, start + 8)
  header.writeUInt32LE(offset, start + 12)
  offset += image.length
})
await writeFile(new URL('favicon.ico', publicDir), Buffer.concat([header, ...images]))
console.log('Generated LinkAPI icons: ICO (16/32/48), PNG (16/32), Apple (180), app (192/512), maskable (512).')
