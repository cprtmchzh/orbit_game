import type { AudioClockSample } from './contracts'
import { timing } from './config'

/** The source and the simulation share this AudioContext's clock, including silent lead-in. */
export function createTransport(context: AudioContext) {
  let node: AudioBufferSourceNode | undefined
  let frozen = 0
  let anchor: number | undefined

  function sample(): AudioClockSample {
    if (anchor === undefined) return { songSec: frozen, resumeRemainingSec: 0 }
    const elapsed = context.currentTime - anchor
    return { songSec: frozen + Math.max(0, elapsed), resumeRemainingSec: Math.max(0, -elapsed) }
  }

  function stop(at = sample().songSec) {
    frozen = at
    anchor = undefined
    if (node) {
      node.onended = null
      node.stop()
      node.disconnect()
      node = undefined
    }
  }

  function schedule(buffer: AudioBuffer, from: number, hold: number): AudioClockSample {
    stop(from)
    if (context.state !== 'running') throw new Error('음악 재생을 시작할 수 없습니다. 다시 눌러 주세요.')
    const when = context.currentTime + hold
    if (from < buffer.duration) {
      const next = context.createBufferSource()
      next.buffer = buffer
      next.connect(context.destination)
      try {
        next.start(when + Math.max(0, -from), Math.max(0, from))
      } catch (error) {
        next.disconnect()
        throw error
      }
      node = next
      next.onended = () => {
        next.disconnect()
        if (node === next) node = undefined
      }
    }
    anchor = when
    return { songSec: from, resumeRemainingSec: hold }
  }

  return {
    sample,
    stop,
    start: (buffer: AudioBuffer) => schedule(buffer, -timing.leadInSec, 0),
    resume: (buffer: AudioBuffer) => schedule(buffer, frozen, timing.resumeHoldSec),
  }
}
