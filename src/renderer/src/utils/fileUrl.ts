function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function encodeFilePath(path: string): string {
  return path.split('/').map((part, index) => {
    if (index === 0) return ''
    const decoded = safeDecode(part)
    if (index === 1 && /^[a-zA-Z]:$/.test(decoded)) return decoded
    return encodeURIComponent(decoded)
  }).join('/')
}

export function toFileUrl(pathOrUrl: string | null | undefined): string {
  const raw = (pathOrUrl ?? '').trim()
  if (!raw) return ''

  if (/^(https?|data|blob):/i.test(raw)) return raw

  if (/^file:\/\//i.test(raw)) {
    if (!raw.includes('\\') && !/^file:\/\/[a-zA-Z]:/i.test(raw)) return raw
    return toFileUrl(raw.replace(/^file:\/\//i, ''))
  }

  const normalized = raw.replace(/\\/g, '/')
  const absolutePath = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `file://${encodeFilePath(absolutePath)}`
}
