export interface WaveformChannelData {
  positive: number[]
  negative: number[]
  rms: number[]
}

export interface WaveformLevel {
  samplesPerPoint: number
  pointsPerSecond: number
  length: number
  channels: WaveformChannelData[]
}

export interface WaveformData {
  version: 1
  path: string
  fileSize: number
  mtimeMs: number
  durationMs: number
  sampleRate: number
  channelCount: number
  levels: WaveformLevel[]
}

const cache = new Map<string, Promise<WaveformData | null>>()

export function getWaveform(path: string): Promise<WaveformData | null> {
  const cached = cache.get(path)
  if (cached) return cached

  const promise = loadWaveform(path)
  cache.set(path, promise)
  return promise
}

export function selectWaveformLevel(waveform: WaveformData, visibleDurationMs: number, widthPx: number): WaveformLevel | null {
  if (waveform.levels.length === 0) return null

  const visibleSeconds = Math.max(0.05, visibleDurationMs / 1000)
  const targetPointsPerSecond = widthPx / visibleSeconds
  const levels = [...waveform.levels].sort((a, b) => a.pointsPerSecond - b.pointsPerSecond)
  return levels.find(level => level.pointsPerSecond >= targetPointsPerSecond) ?? levels[levels.length - 1]
}

async function loadWaveform(path: string): Promise<WaveformData | null> {
  const result = await window.api.getWaveform(path)
  return isWaveformData(result) ? result : null
}

function isWaveformData(value: unknown): value is WaveformData {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WaveformData>
  return candidate.version === 1 && Array.isArray(candidate.levels)
}
