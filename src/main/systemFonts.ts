import type { IpcMain } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const FALLBACK_FONT_FAMILIES = [
  'sans-serif',
  'serif',
  'monospace',
  'Arial',
  'Georgia',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Verdana',
]

let fontCache: string[] | null = null

function normalizeFontName(name: string): string {
  return name.replace(/\s+/g, ' ').trim()
}

function uniqueSortedFontFamilies(fonts: string[]): string[] {
  const seen = new Map<string, string>()
  for (const font of fonts) {
    const normalized = normalizeFontName(font)
    if (!normalized) continue
    const key = normalized.toLocaleLowerCase()
    if (!seen.has(key)) seen.set(key, normalized)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

async function tryListWindowsFontsFromPowerShell(): Promise<string[]> {
  const command = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Drawing',
    '$fonts = New-Object System.Drawing.Text.InstalledFontCollection',
    '$fonts.Families | ForEach-Object { $_.Name }',
  ].join('; ')

  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { windowsHide: true, maxBuffer: 1024 * 1024 },
  )

  return stdout.split(/\r?\n/).map(normalizeFontName).filter(Boolean)
}

function cleanRegistryFontName(name: string): string[] {
  const base = name
    .replace(/\s*\((OpenType|TrueType|Type 1|Bitmap|Raster)\)\s*$/i, '')
    .replace(/\s+(Bold Italic|Bold Oblique|Regular|Bold|Italic|Oblique)$/i, '')
    .trim()

  return base.split(/\s*&\s*/).map(normalizeFontName).filter(Boolean)
}

async function tryListWindowsFontsFromRegistry(): Promise<string[]> {
  const keys = [
    String.raw`HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`,
    String.raw`HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`,
  ]
  const fonts: string[] = []

  for (const key of keys) {
    try {
      const { stdout } = await execFileAsync('reg', ['query', key], {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      })
      for (const line of stdout.split(/\r?\n/)) {
        const match = line.trim().match(/^(.+?)\s+REG_\w+\s+.+$/)
        if (!match) continue
        fonts.push(...cleanRegistryFontName(match[1]))
      }
    } catch {
      // Some keys may not exist, especially the per-user font key.
    }
  }

  return fonts
}

async function tryListFontsFromFontConfig(): Promise<string[]> {
  const { stdout } = await execFileAsync('fc-list', [':', 'family'], {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  })

  return stdout
    .split(/\r?\n/)
    .flatMap(line => line.split(','))
    .map(normalizeFontName)
    .filter(Boolean)
}

export async function listSystemFonts(): Promise<string[]> {
  if (fontCache) return fontCache

  let fonts: string[] = []

  try {
    if (process.platform === 'win32') {
      fonts = await tryListWindowsFontsFromPowerShell()
      if (fonts.length === 0) fonts = await tryListWindowsFontsFromRegistry()
    } else {
      fonts = await tryListFontsFromFontConfig()
    }
  } catch {
    if (process.platform === 'win32') {
      fonts = await tryListWindowsFontsFromRegistry().catch(() => [])
    }
  }

  fontCache = uniqueSortedFontFamilies([...FALLBACK_FONT_FAMILIES, ...fonts])
  return fontCache
}

export function registerSystemFontIpc(ipcMain: IpcMain): void {
  ipcMain.handle('system:listFonts', () => listSystemFonts())
}
