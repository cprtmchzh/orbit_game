import { geometry } from './config'
import type { Collision, Lane, Obstacle } from './contracts'

export function contactHalfWidth(lane: Lane): number {
  return geometry.obstacleHalfWidthRad + Math.asin(geometry.playerRadius / geometry.orbitRadius[lane])
}

export function collisionWindow(obstacle: Obstacle) {
  const halfWidth = contactHalfWidth(obstacle.lane)
  return { startRad: obstacle.centerRad - halfWidth, endRad: obstacle.centerRad + halfWidth }
}

/** Sweep a clockwise segment including both ends. A zero-length segment checks the switch destination. */
export function firstContact(
  lane: Lane,
  fromRad: number,
  toRad: number,
  obstacles: readonly Obstacle[],
): Collision | null {
  let first: Collision | null = null
  for (const obstacle of obstacles) {
    if (obstacle.lane !== lane) continue
    const { startRad, endRad } = collisionWindow(obstacle)
    if (endRad < fromRad || startRad > toRad) continue
    const angleRad = Math.max(fromRad, startRad)
    if (!first || angleRad < first.angleRad) first = { lane, angleRad, obstacle }
  }
  return first
}
