import { angularSpeedRadPerMs as speed, difficultyBands, timing } from './config'
import type { Lane, Obstacle } from './contracts'
import { collisionWindow, contactHalfWidth } from './rules'

const shapes = {
  hold: [0, 0],
  alternate: [0, 1],
  holdThenSwitch: [0, 0, 1],
} as const

type Shape = keyof typeof shapes
const openingShapes: readonly Shape[] = ['hold', 'alternate']
const allShapes: readonly Shape[] = [...openingShapes, 'holdThenSwitch']

function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    // Mulberry32, yielding an unsigned fraction in [0, 1).
    state = (state + 0x6d2b79f5) >>> 0
    let z = Math.imul(state ^ (state >>> 15), state | 1)
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61)
    return ((z ^ (z >>> 14)) >>> 0) / 0x1_0000_0000
  }
}

/** Widen an unsafe candidate once, using the actual collision widths of both lanes. */
export function placeAfter(previous: Obstacle, lane: Lane, intervalMs: number): Obstacle {
  let centerRad = previous.centerRad + intervalMs * speed
  if (previous.lane !== lane) {
    const earliest = collisionWindow(previous).endRad + timing.minSwitchGapMs * speed + contactHalfWidth(lane)
    // Protect the inclusive time bound when the consumer subtracts two accumulated angles.
    const roundingAllowance = 4 * Number.EPSILON * Math.max(1, Math.abs(earliest))
    centerRad = Math.max(centerRad, earliest + roundingAllowance)
  }
  return Object.freeze({ lane, centerRad })
}

export function createPatternSource(seed: number) {
  const random = seededRandom(seed)
  let tail: Obstacle | undefined
  let previousShape: Shape | undefined
  let nextAtMs = 0

  function next() {
    // Use the scheduled game time so different refresh rates choose the same band.
    const generatedAtMs = nextAtMs
    let band: (typeof difficultyBands)[number] = difficultyBands[0]
    for (const candidate of difficultyBands) {
      if (generatedAtMs >= candidate.fromMs) band = candidate
    }
    const candidates = generatedAtMs < difficultyBands[1].fromMs ? openingShapes : allShapes
    const available = candidates.filter(shape => shape !== previousShape)
    const shape = tail ? available[Math.floor(random() * available.length)] : 'hold'
    const mirrored = tail ? random() < 0.5 : false
    const opening = !tail
    const obstacles: Obstacle[] = []
    for (const swap of shapes[shape]) {
      const lane = Boolean(swap) !== mirrored ? 'outer' : 'inner'
      if (tail) {
        const fraction = opening ? 0.5 : random()
        const interval = band.minIntervalMs + (band.maxIntervalMs - band.minIntervalMs) * fraction
        tail = placeAfter(tail, lane, interval)
      } else {
        tail = Object.freeze({ lane, centerRad: timing.firstSafeMs * speed + contactHalfWidth(lane) })
      }
      obstacles.push(tail)
    }
    previousShape = shape
    // The next batch is scheduled as soon as this batch's last obstacle is due to be shown.
    nextAtMs = collisionWindow(obstacles[obstacles.length - 1]).startRad / speed - timing.revealLeadMs
    return { shape, generatedAtMs, obstacles }
  }

  return { next, get nextAtMs() { return nextAtMs } }
}
