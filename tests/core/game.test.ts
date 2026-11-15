import { expect, it } from 'vitest'
import { buildChart, parseChart } from '../../src/chart'
import { geometry } from '../../src/config'
import { createGame } from '../../src/game'
import { contactHalfSec, headContact } from '../../src/rules'

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
  const movement = game.getSnapshot().movement!
  for (let t = -0.04 + 1/hz; t < 0.4; t += 1/hz) game.update(clock(t))
  game.dispatch('down', clock(0.4))
  const s = game.getSnapshot()
  expect(s).toMatchObject({ state: 'PLAYING', hits: 1, misses: 0, songSec: 0.4 })
  const note = chart.heads[0]
  expect(s.visibleHeads.map(h => h.note)).not.toContain(note)
  const hit = headContact(chart.lanes, 2, movement, note, -0.04, 0.12)
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
  expect(hit).not.toBeNull()
  expect(Math.abs(hit! - late)).toBeLessThan(1e-8)
  game.dispatch('pause', clock(0.4))
  game.dispatch('retry', clock(-2))
  expect(game.getSnapshot()).toMatchObject({ state: 'LEAD_IN', hits: 0, misses: 0, movement: null, songSec: -2 })
})

it('shows and collides with an original zero-second note during pre-roll', () => {
  const { game } = setup([2, 3, 0, 3.5, 4])
  expect(game.getSnapshot().visibleHeads[0]).toMatchObject({ note: { arrivalSec: 0 }, x: geometry.width - geometry.headRadius })
  game.dispatch('up', clock(0))
  expect(game.getSnapshot()).toMatchObject({ state: 'PLAYING', songSec: 0, hits: 1, misses: 0 })
  game.update(clock(0))
  expect(game.getSnapshot().hits).toBe(1)
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
  expect(game.getSnapshot()).toMatchObject({ state: 'CLEARED', songSec: 3 + contactHalfSec, progress: 1, hits: 0, misses: 5, totalNotes: 5 })
})

it('scores all contacts in a long step once, expires misses only after the inclusive window', () => {
  const { game } = setup([1, 1, 1, 1, 1], 2)
  game.update(clock(1))
  expect(game.getSnapshot()).toMatchObject({ hits: 1, misses: 0, totalNotes: 5 })
  expect(game.getSnapshot().visibleHeads).toHaveLength(4)
  game.update(clock(1 + contactHalfSec))
  expect(game.getSnapshot().misses).toBe(0)
  game.dispatch('pause', clock(1 + contactHalfSec))
  game.update(clock(50))
  expect(game.getSnapshot()).toMatchObject({ state: 'PAUSED', hits: 1, misses: 0 })
  game.dispatch('resume', clock(1 + contactHalfSec, 1))
  game.update(clock(1 + contactHalfSec, 0))
  game.update(clock(1.1))
  expect(game.getSnapshot()).toMatchObject({ state: 'PLAYING', hits: 1, misses: 4 })
  game.update(clock(5))
  expect(game.getSnapshot()).toMatchObject({ state: 'CLEARED', hits: 1, misses: 4 })
})

it('counts a merged unison once and collects each successive head across a single frame', () => {
  const { chart } = setup()
  const source = chart.source
  const extra = { ...source.notes[2], startSec: 0.5, id: 'new' }
  const duplicated = { ...extra, id: 'unison' }
  const game = createGame(buildChart({ ...source, notes: [...source.notes, extra, duplicated] }))
  game.dispatch('start', clock(-2))
  game.update(clock(5))
  expect(game.getSnapshot()).toMatchObject({ state: 'CLEARED', hits: 2, misses: 4, totalNotes: 6 })
  game.dispatch('retry', clock(-2))
  expect(game.getSnapshot()).toMatchObject({ state: 'LEAD_IN', hits: 0, misses: 0, totalNotes: 6 })
})

it('awards every overlapping chord head even when multiple centers are touched in one frame', () => {
  const { game } = setup(Array(25).fill(1), 2)
  // With the 25 distinct pitches 16 units apart, the center lane touches either neighbor.
  game.update(clock(1))
  expect(game.getSnapshot()).toMatchObject({ hits: 3, misses: 0, totalNotes: 25 })
  game.update(clock(3))
  expect(game.getSnapshot()).toMatchObject({ state: 'CLEARED', hits: 3, misses: 22 })
})
