import { expect, it } from 'vitest'
import { buildChart, parseChart } from '../../src/chart'
import { geometry } from '../../src/config'
import { createGame } from '../../src/game'
import { contactHalfSec } from '../../src/rules'

const clock = (songSec: number, resumeRemainingSec = 0) => ({ songSec, resumeRemainingSec })
function setup(times = [1, 2, 3, 3.5, 4], length = 5) {
  const chart = buildChart(parseChart({
    schemaVersion: 2, songId: 'test', title: 'Test', chartVersion: '1', audioDurationSec: length,
    offsetSec: 0, defaultTrackIds: ['m'], tracks: [{ id: 'm', name: 'm', kind: 'pitched' }],
    notes: times.map((startSec, i) => ({ id: String(i), trackId: 'm', pitch: 72-i, startSec, durationSec: 1 })),
  }))
  const game = createGame(chart)
  game.dispatch('start', clock(-2))
  return { chart, game }
}

it('advances smooth adjacent movement during negative preparation; only last queued direction survives', () => {
  const { chart, game } = setup()
  game.dispatch('up', clock(-2))
  game.update(clock(-1.96))
  const y = chart.lanes[2].y + (chart.lanes[1].y - chart.lanes[2].y) * 0.15625
  expect(game.getSnapshot().player.y).toBeCloseTo(y)
  game.dispatch('up', clock(-1.96))
  game.dispatch('down', clock(-1.94))
  expect(game.getSnapshot().queuedDirection).toBe('down')
  game.update(clock(-1.65))
  expect(game.getSnapshot()).toMatchObject({ state: 'LEAD_IN', movement: null, queuedDirection: null, player: { y: chart.lanes[2].y } })
  game.dispatch('up', clock(-1.6))
  game.dispatch('up', clock(-1.5))
  game.update(clock(-1))
  game.dispatch('up', clock(-1))
  expect(game.getSnapshot().movement).toBeNull()
  expect(game.getSnapshot().player.y).toBe(chart.lanes[0].y)
})

it('freezes position and movement while paused and throughout a resume hold', () => {
  const { game } = setup()
  game.dispatch('down', clock(-1))
  game.dispatch('pause', clock(-0.93))
  const y = game.getSnapshot().player.y
  game.update(clock(7))
  game.dispatch('resume', clock(-0.93, 1))
  game.dispatch('up', clock(-0.93, 0.5))
  expect(game.getSnapshot()).toMatchObject({ state: 'RESUMING', player: { y }, songSec: -0.93, queuedDirection: null })
  game.update(clock(-0.90, 0))
  expect(game.getSnapshot().state).toBe('LEAD_IN')
  expect(game.getSnapshot().player.y).toBeGreaterThan(y)
})

it.each([30, 60, 120, 1])('detects the earliest moving contact between frames at %i Hz', hz => {
  const { game, chart } = setup([2, 0.08, 3, 4, 5], 6)
  game.dispatch('up', clock(-0.04))
  for (let t = -0.04 + 1/hz; t < 0.4; t += 1/hz) game.update(clock(t))
  game.dispatch('down', clock(0.4))
  const s = game.getSnapshot()
  expect(s.state).toBe('FAILED')
  expect(s.songSec).toBeGreaterThan(0.03)
  expect(s.songSec).toBeLessThan(0.12)
  expect(s.player.y).toBeGreaterThan(chart.lanes[1].y)
  expect(s.player).toEqual(s.collision?.player)
  const hit = s.collision!
  expect(Math.hypot(hit.player.x-hit.noteHead.x, hit.player.y-hit.noteHead.y)).toBeCloseTo(geometry.playerRadius + geometry.headRadius, 4)
  // Until the target note arrives both horizontal and vertical distances decrease. Find the
  // earliest intersection independently of frame boundaries and of the production search.
  let early = -0.04
  let late = 0.08
  for (let step = 0; step < 50; step++) {
    const t = (early + late) / 2
    const u = (t + 0.04) / 0.16
    const dx = geometry.scrollUnitsPerSec * (0.08 - t)
    const dy = (chart.lanes[2].y - chart.lanes[1].y) * (1 - 3 * u * u + 2 * u ** 3)
    if (Math.hypot(dx, dy) <= geometry.playerRadius + geometry.headRadius) late = t
    else early = t
  }
  expect(Math.abs(hit.songSec - late)).toBeLessThan(1e-8)
  expect(hit.noteHead.note.sourceIds).toEqual(['1'])
  game.dispatch('retry', clock(-2))
  expect(game.getSnapshot()).toMatchObject({ state: 'LEAD_IN', collision: null, movement: null, songSec: -2 })
})

it('shows and collides with an original zero-second note during pre-roll', () => {
  const { game } = setup([2, 3, 0, 3.5, 4])
  expect(game.getSnapshot().visibleHeads[0]).toMatchObject({ note: { arrivalSec: 0 }, x: geometry.width - geometry.headRadius })
  game.dispatch('up', clock(0))
  expect(game.getSnapshot().songSec).toBeCloseTo(-contactHalfSec, 10)
  expect(game.getSnapshot().state).toBe('FAILED')
})

it('ignores the decorative tail and waits for passage beyond the final inclusive head window', () => {
  const { game } = setup([0, 0.5, 1, 2, 3], 3)
  game.dispatch('down', clock(0.5))
  game.dispatch('up', clock(1.2))
  game.update(clock(3))
  expect(game.getSnapshot().state).toBe('PLAYING')
  game.update(clock(3 + contactHalfSec))
  expect(game.getSnapshot().state).toBe('PLAYING')
  game.update(clock(4))
  expect(game.getSnapshot()).toMatchObject({ state: 'CLEARED', songSec: 3 + contactHalfSec, progress: 1 })
})
