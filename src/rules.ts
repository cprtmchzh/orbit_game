import { geometry, noteHeadX } from './config'
import type { ChartHead, Circle, Lane, Movement, VisibleHead } from './contracts'

const radius = geometry.playerRadius + geometry.headRadius
export const contactHalfSec = radius / geometry.scrollUnitsPerSec

export function playerY(lanes: readonly Lane[], lane: number, move: Movement | null, sec: number): number {
  if (!move) return lanes[lane].y
  const u = Math.min(1, Math.max(0, (sec - move.startSec) / (move.endSec - move.startSec)))
  const from = lanes[move.fromLane].y
  return from + (lanes[move.toLane].y - from) * u * u * (3 - 2 * u)
}

export function playerCircle(y: number): Circle {
  return { x: geometry.playerX, y, radius: geometry.playerRadius }
}

export function headCircle(note: ChartHead, y: number, sec: number): VisibleHead {
  return { note, x: noteHeadX(note.arrivalSec, sec), y, radius: geometry.headRadius }
}

/** Heads are sorted by time. Skip the entire expired prefix even on long local charts. */
export function firstHeadAt(heads: readonly ChartHead[], sec: number): number {
  let lo = 0
  let hi = heads.length
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2)
    if (heads[mid].arrivalSec < sec) lo = mid + 1
    else hi = mid
  }
  return lo
}

function distanceToRange(value: number, a: number, b: number): number {
  return Math.max(Math.min(a, b) - value, value - Math.max(a, b), 0)
}

// On one movement segment both axes are monotone. The bounding rectangle contains the whole
// curve. Subdivide left-first to cover grazing contacts; at 10 ns the worst spatial allowance
// is <0.00004 logical units (384 units * 1.5 / 0.160s plus the horizontal scroll speed).
function movingContact(a: number, b: number, at: number, targetY: number, yAt: (sec: number) => number): number | null {
  const dx = distanceToRange(at, a, b) * geometry.scrollUnitsPerSec
  const dy = distanceToRange(targetY, yAt(a), yAt(b))
  if (dx * dx + dy * dy > radius * radius + 1e-10) return null
  if (b - a <= 1e-8) return a
  const mid = (a + b) / 2
  return movingContact(a, mid, at, targetY, yAt) ?? movingContact(mid, b, at, targetY, yAt)
}

/** First contact with one head during a single uninterrupted movement segment. */
export function headContact(lanes: readonly Lane[], lane: number, move: Movement | null, note: ChartHead, from: number, to: number): number | null {
  const left = Math.max(from, note.arrivalSec - contactHalfSec)
  const right = Math.min(to, note.arrivalSec + contactHalfSec)
  if (left > right) return null
  const y = lanes[note.laneIndex].y
  if (move) return movingContact(left, right, note.arrivalSec, y, sec => playerY(lanes, lane, move, sec))
  const dy = y - lanes[lane].y
  if (Math.abs(dy) > radius) return null
  const width = Math.sqrt(radius * radius - dy * dy) / geometry.scrollUnitsPerSec
  const hit = Math.max(left, note.arrivalSec - width)
  return hit <= right && hit <= note.arrivalSec + width ? hit : null
}
