export interface TimelinePlaybackClockOptions {
  getDuration: () => number
  onTick: (timeMs: number) => void
  onEnd: () => void
}

export interface TimelinePlaybackClock {
  play(startTimeMs: number): void
  pause(): void
  dispose(): void
  isRunning(): boolean
}

export function createTimelinePlaybackClock(options: TimelinePlaybackClockOptions): TimelinePlaybackClock {
  let rafId = 0
  let running = false
  let anchorWallTime = 0
  let anchorTimelineTime = 0

  function cancelTick() {
    if (!rafId) return
    cancelAnimationFrame(rafId)
    rafId = 0
  }

  function tick() {
    if (!running) return

    const timeMs = anchorTimelineTime + performance.now() - anchorWallTime
    const durationMs = options.getDuration()

    if (timeMs >= durationMs) {
      running = false
      cancelTick()
      options.onEnd()
      return
    }

    options.onTick(timeMs)
    rafId = requestAnimationFrame(tick)
  }

  return {
    play(startTimeMs: number) {
      cancelTick()
      running = true
      anchorWallTime = performance.now()
      anchorTimelineTime = Math.max(0, startTimeMs)
      rafId = requestAnimationFrame(tick)
    },
    pause() {
      running = false
      cancelTick()
    },
    dispose() {
      running = false
      cancelTick()
    },
    isRunning() {
      return running
    },
  }
}
