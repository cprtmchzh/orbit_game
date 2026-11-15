import { describe, expect, it, vi } from 'vitest'
import { angularSpeedRadPerMs as speed, difficultyBands, geometry, timing } from '../../src/config'
import type { GameController, Obstacle } from '../../src/contracts'
import { createGame } from '../../src/game'
import { createPatternSource, placeAfter } from '../../src/patterns'

// Independent geometric oracle for the rendered annular sector and player disk.
function collisionWindow(obstacle: Obstacle) {
  const playerWidth = Math.asin(geometry.playerRadius / geometry.orbitRadius[obstacle.lane])
  const halfWidth = geometry.obstacleHalfWidthRad + playerWidth
  return { startRad: obstacle.centerRad - halfWidth, endRad: obstacle.centerRad + halfWidth }
}

function check(ok: boolean, message: string) {
  if (!ok) throw new Error(message)
}

function start(game: GameController, atMs: number) {
  game.dispatch('start', atMs)
  for (let dt = 250; dt <= timing.countdownMs; dt += 250) game.update(atMs + dt)
}

/** Record what the public production game actually showed, with the largest supported frame step. */
function play(game: GameController, runningAtMs: number, durationMs: number) {
  const firstSeen = new Map<number, number>()
  for (let playMs = 0; playMs <= durationMs; playMs += timing.maxFrameGapMs) {
    const atMs = runningAtMs + playMs
    game.update(atMs)
    const snapshot = game.getSnapshot()
    check(snapshot.state === 'RUNNING' && snapshot.survivalMs === playMs, 'simulation stopped at ' + playMs)
    for (const obstacle of snapshot.visibleObstacles) {
      const window = collisionWindow(obstacle)
      check(window.endRad >= snapshot.angleRad, 'expired obstacle still visible')
      if (!firstSeen.has(obstacle.centerRad)) {
        const warning = window.startRad / speed - playMs
        check(warning >= timing.minWarningMs && warning <= timing.revealLeadMs + 1e-8, 'warning out of range at ' + playMs)
        firstSeen.set(obstacle.centerRad, warning)
      }
    }
    if (snapshot.visibleObstacles[0]?.lane === snapshot.lane) game.dispatch('switch', atMs)
  }
  return firstSeen
}

describe('P0 pattern generation', () => {
  it('corrects an unsafe requested gap in one placement using both collision widths', () => {
    for (const lane of ['inner', 'outer'] as const) {
      const previous = { lane, centerRad: 30 }
      const next = placeAfter(previous, lane === 'inner' ? 'outer' : 'inner', 0)
      const gap = (collisionWindow(next).startRad - collisionWindow(previous).endRad) / speed
      expect(gap).toBeGreaterThanOrEqual(timing.minSwitchGapMs)
      expect(gap).toBeCloseTo(timing.minSwitchGapMs, 8)
      expect(next.centerRad).toBeGreaterThan(previous.centerRad)
    }
  })

  it('replays an injected seed on retry and draws a fresh seed for every unseeded run', () => {
    function twoRounds(game: GameController) {
      start(game, 0)
      const first = play(game, 1000, 20000)
      game.dispatch('pause', 21000)
      game.dispatch('retry', 21000)
      for (let t = 21250; t <= 22000; t += 250) game.update(t)
      return [first, play(game, 22000, 20000)]
    }
    const [first, again] = twoRounds(createGame(5678))
    expect(first).toEqual(again)
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0.25).mockReturnValueOnce(0.8)
    try {
      const [a, b] = twoRounds(createGame())
      expect([...a.keys()].slice(0, 2)).toEqual([...b.keys()].slice(0, 2))
      expect(a).not.toEqual(b)
      expect(random).toHaveBeenCalledTimes(2)
    } finally {
      random.mockRestore()
    }
  })

  it('continues after 120 seconds with no further acceleration', () => {
    const game = createGame(999)
    start(game, 0)
    const seen = play(game, 1000, 240000)
    expect([...seen.keys()].some(angle => angle / speed > 239000)).toBe(true)
  })

  it('audits 1,000 deterministic seeds for 120s, including seams and actual visibility', () => {
    const durationMs = 120000
    const stats = {
      seeds: 1000, durationMs, obstacles: 0, insidePairs: 0, seamPairs: 0,
      minInsideGapMs: Infinity, minSeamGapMs: Infinity, minWarningMs: Infinity,
    }
    const failures: { seed: number, reason: string }[] = []
    const observedShapes = new Set<string>()
    const usedBands = new Set<number>()
    for (let seed = 0; seed < stats.seeds; seed++) {
      try {
        const source = createPatternSource(seed)
        const game = createGame(seed)
        start(game, 0)
        const firstSeen = play(game, 1000, durationMs)
        let previous: Obstacle | undefined
        let previousShape = ''
        let batches = 0
        while (source.nextAtMs <= durationMs) {
          check(++batches <= durationMs / 650 + 2, 'generation did not advance')
          const { shape, obstacles, generatedAtMs } = source.next()
          check(source.nextAtMs > generatedAtMs, 'non-monotonic generation')
          check(shape !== previousShape, 'consecutive duplicate shape')
          previousShape = shape
          const laneSequence = obstacles.map(o => o.lane === obstacles[0].lane ? 'A' : 'B').join('')
          check(laneSequence === { hold: 'AA', alternate: 'AB', holdThenSwitch: 'AAB' }[shape], 'wrong shape')
          observedShapes.add(shape + '/' + obstacles[0].lane)
          const band = [...difficultyBands].reverse().find(b => b.fromMs <= generatedAtMs)!
          usedBands.add(band.fromMs)
          check(generatedAtMs >= 15000 || shape !== 'holdThenSwitch', 'early third shape')
          for (const [index, obstacle] of obstacles.entries()) {
            const startMs = collisionWindow(obstacle).startRad / speed
            if (startMs > durationMs) continue
            stats.obstacles++
            const warning = firstSeen.get(obstacle.centerRad)
            check(warning !== undefined, 'expected obstacle missing from the game')
            stats.minWarningMs = Math.min(stats.minWarningMs, warning!)
            if (!previous) {
              check(startMs >= timing.firstSafeMs, 'unsafe opening')
              check(obstacle.lane === 'inner', 'unexpected opening lane')
            } else {
              const centerGap = (obstacle.centerRad - previous.centerRad) / speed
              check(centerGap >= band.minIntervalMs - 1e-8 && centerGap <= band.maxIntervalMs + 1e-8, 'wrong band')
              if (previous.lane !== obstacle.lane) {
                const gap = startMs - collisionWindow(previous).endRad / speed
                check(gap >= timing.minSwitchGapMs, `unsafe lane change at ${startMs}ms, ${shape}[${index}], gap=${gap}`)
                if (index === 0) {
                  stats.seamPairs++
                  stats.minSeamGapMs = Math.min(stats.minSeamGapMs, gap)
                } else {
                  stats.insidePairs++
                  stats.minInsideGapMs = Math.min(stats.minInsideGapMs, gap)
                }
              }
            }
            previous = obstacle
          }
        }
      } catch (e) {
        failures.push({ seed, reason: String(e) })
      }
    }
    console.info('P0 pattern audit', JSON.stringify({ ...stats, failures }))
    expect(failures).toEqual([])
    expect(stats.insidePairs).toBeGreaterThan(0)
    expect(stats.seamPairs).toBeGreaterThan(0)
    expect(observedShapes.size).toBe(6)
    expect([...usedBands].sort((a, b) => a - b)).toEqual([0, 15000, 30000, 60000])
  }, 30000)
})
