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

const FALLBACK_POINTS_PER_SECOND = [4, 16, 64]
const cache = new Map<string, Promise<WaveformData | null>>()

export function getWaveform(path: string): Promise<WaveformData | null> {
  const cached = cache.get(path)
  if (cached) return cached

  const promise = loadWaveform(path).catch((err: unknown) => {
    cache.delete(path)
    console.warn('Failed to load waveform', path, err)
    return null
  })
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
  if (typeof window.api.getWaveform === 'function') {
    const result = await window.api.getWaveform(path)
    if (isWaveformData(result)) return result
    if (isWaveformError(result)) console.warn('Main waveform analysis failed', path, result.error)
  }

  return generateRendererFallback(path)
}

function isWaveformData(value: unknown): value is WaveformData {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WaveformData>
  return candidate.version === 1 && Array.isArray(candidate.levels)
}

function isWaveformError(value: unknown): value is { error: string } {
  return Boolean(value && typeof value === 'object' && typeof (value as { error?: unknown }).error === 'string')
}

async function generateRendererFallback(path: string): Promise<WaveformData | null> {
  const normalized = path.replace(/\\/g, '/')
  const url = /^[a-zA-Z]:/.test(normalized) ? `file:///${normalized}` : `file://${normalized}`
  const ctx = new AudioContext()
  try {
    const res = await fetch(url)
    const buf = await res.arrayBuffer()
    const audio = await ctx.decodeAudioData(buf)
    const channelCount = Math.min(2, audio.numberOfChannels)
    if (channelCount <= 0 || audio.length <= 0) return null

    let maxPeak = 0
    const rawLevels = FALLBACK_POINTS_PER_SECOND.map(pointsPerSecond => {
      const samplesPerPoint = Math.max(1, Math.round(audio.sampleRate / pointsPerSecond))
      const length = Math.ceil(audio.length / samplesPerPoint)
      const channels = Array.from({ length: channelCount }, (_, channelIndex) => {
        const data = audio.getChannelData(channelIndex)
        const positive: number[] = []
        const negative: number[] = []
        const rms: number[] = []

        for (let point = 0; point < length; point++) {
          const start = point * samplesPerPoint
          const end = Math.min(start + samplesPerPoint, data.length)
          let pos = 0
          let neg = 0
          let sumSq = 0

          for (let i = start; i < end; i++) {
            const sample = data[i] ?? 0
            if (sample > pos) pos = sample
            if (sample < neg) neg = sample
            sumSq += sample * sample
          }

          maxPeak = Math.max(maxPeak, pos, Math.abs(neg))
          positive.push(pos)
          negative.push(neg)
          rms.push(end > start ? Math.sqrt(sumSq / (end - start)) : 0)
        }

        return { positive, negative, rms }
      })

      return { samplesPerPoint, pointsPerSecond, length, channels }
    })

    const normalizeBy = maxPeak > 0 ? maxPeak : 1
    const levels = rawLevels.map(level => ({
      ...level,
      channels: level.channels.map(channel => ({
        positive: channel.positive.map(value => quantize(value / normalizeBy)),
        negative: channel.negative.map(value => quantize(value / normalizeBy)),
        rms: channel.rms.map(value => quantize(value / normalizeBy)),
      })),
    }))

    return {
      version: 1,
      path,
      fileSize: 0,
      mtimeMs: 0,
      durationMs: Math.round(audio.duration * 1000),
      sampleRate: audio.sampleRate,
      channelCount,
      levels,
    }
  } finally {
    void ctx.close()
  }
}

function quantize(value: number): number {
  return Math.round(value * 10000) / 10000
}
