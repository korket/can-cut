export type WaveformData = {
  peaks: Float32Array   // max absolute amplitude per block
  rms:   Float32Array   // RMS amplitude per block
  length: number
}

const SAMPLES = 4096

const cache = new Map<string, Promise<WaveformData>>()

export function getWaveform(path: string): Promise<WaveformData> {
  if (cache.has(path)) return cache.get(path)!
  const promise = generate(path)
  cache.set(path, promise)
  return promise
}

async function generate(path: string): Promise<WaveformData> {
  const normalized = path.replace(/\\/g, '/')
  const url = /^[a-zA-Z]:/.test(normalized) ? `file:///${normalized}` : `file://${normalized}`
  const ctx = new AudioContext()
  try {
    const res  = await fetch(url)
    const buf  = await res.arrayBuffer()
    const audio = await ctx.decodeAudioData(buf)

    const channels  = audio.numberOfChannels
    const blockSize = Math.max(1, Math.floor(audio.length / SAMPLES))
    const peaks = new Float32Array(SAMPLES)
    const rms   = new Float32Array(SAMPLES)

    for (let i = 0; i < SAMPLES; i++) {
      let peakAcc = 0
      let rmsAcc  = 0
      for (let c = 0; c < channels; c++) {
        const ch    = audio.getChannelData(c)
        const start = i * blockSize
        const end   = Math.min(start + blockSize, audio.length)
        let peakCh  = 0
        let sumSq   = 0
        for (let j = start; j < end; j++) {
          const s = Math.abs(ch[j])
          if (s > peakCh) peakCh = s
          sumSq += ch[j] * ch[j]
        }
        peakAcc += peakCh
        rmsAcc  += Math.sqrt(sumSq / (end - start))
      }
      peaks[i] = peakAcc / channels
      rms[i]   = rmsAcc  / channels
    }

    // Normalize both to the true peak
    let maxPeak = 0
    for (let i = 0; i < SAMPLES; i++) if (peaks[i] > maxPeak) maxPeak = peaks[i]
    if (maxPeak > 0) {
      for (let i = 0; i < SAMPLES; i++) {
        peaks[i] /= maxPeak
        rms[i]   /= maxPeak
      }
    }

    return { peaks, rms, length: SAMPLES }
  } finally {
    ctx.close()
  }
}
