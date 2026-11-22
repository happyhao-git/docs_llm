export function clipboardImages(data: DataTransfer | null): File[] {
  if (!data) return []
  const files = Array.from(data.items ?? [])
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null)
  // Some browsers expose clipboard files without DataTransfer items.
  return files.length ? files : Array.from(data.files ?? []).filter(file => file.type.startsWith('image/'))
}

// Keep the insertion point with its surrounding text while an upload is pending.
export function moveImageInsertion(position: number, previous: string, next: string): number {
  let start = 0
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++
  let oldEnd = previous.length
  let newEnd = next.length
  while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === next[newEnd - 1]) {
    oldEnd--
    newEnd--
  }
  if (position <= start) return position
  if (position >= oldEnd) return position + newEnd - oldEnd
  return newEnd
}
