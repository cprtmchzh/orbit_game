import { angularSpeedRadPerMs as speed, timing } from './config'
import type { Collision, GameCommand, GameController, GameSnapshot, GameState, Lane, Obstacle } from './contracts'
import { collisionWindow, contactHalfWidth, firstContact } from './rules'

/** A fixed opening obstacle for the first playable loop. The seed is reserved for the pattern generator. */
export function createGame(_seed?: number): GameController {
  const opening: Obstacle = Object.freeze({
    lane: 'inner',
    centerRad: timing.firstSafeMs * speed + contactHalfWidth('inner'),
  })
  const obstacles = [opening]
  let state: GameState = 'READY'
  let lane: Lane = 'inner'
  let survivalMs = 0
  let collision: Collision | null = null
  let lastAtMs: number | undefined
  let countdownEndMs = 0
  let retryAtMs = 0
  // Applies only while running. Re-anchor after every countdown to exclude paused time.
  let runOriginMs = 0

  function finish(hit: Collision, atMs: number) {
    collision = Object.freeze(hit)
    survivalMs = hit.angleRad / speed
    state = 'GAME_OVER'
    retryAtMs = atMs + timing.retryLockMs
  }

  function update(atMs: number) {
    if (!Number.isFinite(atMs) || (lastAtMs !== undefined && atMs < lastAtMs)) return
    const gapMs = atMs - (lastAtMs ?? atMs)
    lastAtMs = atMs
    if (state !== 'COUNTDOWN' && state !== 'RUNNING') return
    if (gapMs > timing.maxFrameGapMs) {
      state = 'PAUSED'
      return
    }
    if (state === 'COUNTDOWN') {
      if (atMs < countdownEndMs) return
      runOriginMs = countdownEndMs - survivalMs
      state = 'RUNNING'
    }
    const nextMs = atMs - runOriginMs
    const hit = firstContact(lane, survivalMs * speed, nextMs * speed, obstacles)
    if (hit) finish(hit, atMs)
    else survivalMs = nextMs
  }

  function countdown(atMs: number, reset: boolean) {
    if (reset) {
      lane = 'inner'
      survivalMs = 0
      collision = null
    }
    state = 'COUNTDOWN'
    countdownEndMs = atMs + timing.countdownMs
  }

  function canRetry() {
    return state === 'PAUSED' || (state === 'GAME_OVER' && (lastAtMs ?? 0) >= retryAtMs)
  }

  function dispatch(command: GameCommand, atMs: number) {
    if (!Number.isFinite(atMs) || (lastAtMs !== undefined && atMs < lastAtMs)) return
    const before = state
    update(atMs)
    // A command that discovered a collision or a long gap belongs to the original screen.
    if (state !== before && (state === 'GAME_OVER' || state === 'PAUSED')) return
    switch (command) {
      case 'start':
        if (state === 'READY') countdown(atMs, true)
        break
      case 'retry':
        if (canRetry()) countdown(atMs, true)
        break
      case 'pause':
        if (state === 'RUNNING' || state === 'COUNTDOWN') state = 'PAUSED'
        break
      case 'resume':
        if (state === 'PAUSED') countdown(atMs, false)
        break
      case 'switch':
        if (state === 'RUNNING') {
          lane = lane === 'inner' ? 'outer' : 'inner'
          const angle = survivalMs * speed
          const hit = firstContact(lane, angle, angle, obstacles)
          if (hit) finish(hit, atMs)
        }
        break
    }
  }

  function getSnapshot(): GameSnapshot {
    const angleRad = collision?.angleRad ?? survivalMs * speed
    const visibleObstacles = obstacles.filter(obstacle => {
      const { startRad, endRad } = collisionWindow(obstacle)
      return angleRad >= startRad - timing.revealLeadMs * speed && angleRad <= endRad
    })
    return {
      state, lane, angleRad, survivalMs, visibleObstacles, collision,
      countdownRemainingMs: state === 'COUNTDOWN' ? countdownEndMs - (lastAtMs ?? 0) : 0,
      canRetry: canRetry(),
    }
  }

  return { update, dispatch, getSnapshot }
}
