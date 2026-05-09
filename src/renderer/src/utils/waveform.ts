const cache = new Map<string, Promise<number[]>>()

export function getWaveform(path: string): Promise<number[]> {
  if (cache.has(path)) return cache.get(path)!
  const promise = generate(path)
  cache.set(path, promise)
  return promise
}

async function generate(path: string): Promise<number[]> {
  const normalized = path.replace(/\\/g, '/')
  const url = /^[a-zA-Z]:/.test(normalized) ? `file:///${normalized}` : `file://${normalized}`
  const ctx = new AudioContext()
  try {
    const res = await fetch(url)
    const buf = await res.arrayBuffer()
    const audio = await ctx.decodeAudioData(buf)
    const data = audio.getChannelData(0)
    const samples = 300
    const block = Math.floor(data.length / samples)
    return Array.from({ length: samples }, (_, i) => {
      let sum = 0
      for (let j = 0; j < block; j++) sum += Math.abs(data[i * block + j])
      return Math.min(1, (sum / block) * 3.5)
    })
  } finally {
    ctx.close()
  }
}
