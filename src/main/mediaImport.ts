import { promises as fs } from 'fs'
import { basename, extname, join } from 'path'
import type { IpcMain } from 'electron'

const SUPPORTED_EXTS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.wmv', '.flv',
  '.mp3', '.wav', '.aac', '.m4a', '.ogg', '.flac',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.avif',
])

const MAX_IMPORT_FILES = 5000

export interface MediaImportEntry {
  sourcePath: string
  name: string
  isDirectory: boolean
  files: string[]
  skipped: number
}

function isSupported(path: string) {
  return SUPPORTED_EXTS.has(extname(path).toLowerCase())
}

async function collectMediaFiles(dir: string, budget: { count: number }): Promise<{ files: string[]; skipped: number }> {
  let skipped = 0
  const files: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
    if (budget.count >= MAX_IMPORT_FILES) {
      skipped += 1
      continue
    }

    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      const nested = await collectMediaFiles(fullPath, budget)
      files.push(...nested.files)
      skipped += nested.skipped
      continue
    }

    if (!entry.isFile()) continue
    if (!isSupported(fullPath)) {
      skipped += 1
      continue
    }

    budget.count += 1
    files.push(fullPath)
  }

  return {
    files: files.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    skipped,
  }
}

async function resolveImportPath(path: string): Promise<MediaImportEntry | null> {
  try {
    const stat = await fs.stat(path)

    if (stat.isDirectory()) {
      const collected = await collectMediaFiles(path, { count: 0 })
      return {
        sourcePath: path,
        name: basename(path) || path,
        isDirectory: true,
        files: collected.files,
        skipped: collected.skipped,
      }
    }

    if (!stat.isFile() || !isSupported(path)) return null

    return {
      sourcePath: path,
      name: basename(path) || path,
      isDirectory: false,
      files: [path],
      skipped: 0,
    }
  } catch {
    return null
  }
}

export function registerMediaImportIpc(ipcMain: IpcMain): void {
  ipcMain.handle('media:resolveImportPaths', async (_event, paths: string[]) => {
    const uniquePaths = [...new Set((Array.isArray(paths) ? paths : []).filter(Boolean))]
    const entries = await Promise.all(uniquePaths.map(resolveImportPath))
    return entries.filter((entry): entry is MediaImportEntry => Boolean(entry))
  })
}
