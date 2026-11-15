import { describe, expect, it } from 'vitest'
import { angularSpeedRadPerMs as speed, timing } from '../../src/config'
import type { GameController } from '../../src/contracts'
import { createGame } from '../../src/game'
import { collisionWindow, firstContact } from '../../src/rules'

function frames(game: GameController, from: number, to: number, hz = 60) {
  for (let frame = 1; from + frame * 1000 / hz < to; frame++) {
    game.update(from + frame * 1000 / hz)
  }
  game.update(to)
}

function running() {
  const game = createGame(42)
  game.dispatch('start', 0)
  frames(game, 0, 1000)
  return game
}

describe('accumulated contact angles', () => {
  const deg = Math.PI / 180
  it('includes both boundaries and excludes the opposite lane', () => {
    const obstacle = { lane: 'outer' as const, centerRad: 2 }
    const { startRad, endRad } = collisionWindow(obstacle)
    for (const edge of [startRad, endRad]) {
      expect(firstContact('outer', edge, edge, [obstacle])?.angleRad).toBe(edge)
      expect(firstContact('inner', edge, edge, [obstacle])).toBeNull()
    }
  })
  it('sweeps across 359–361 degrees and separates successive revolutions', () => {
    const obstacle = { lane: 'inner' as const, centerRad: 365 * deg }
    const start = collisionWindow(obstacle).startRad
    expect(start).toBeGreaterThan(359 * deg)
    expect(firstContact('inner', 359 * deg, 361 * deg, [obstacle])?.angleRad).toBe(start)
    expect(firstContact('inner', 719 * deg, 721 * deg, [obstacle])).toBeNull()
  })
  it('returns the first contact when the frame crosses multiple unsorted intervals', () => {
    const first = { lane: 'outer' as const, centerRad: 8 }
    const later = { ...first, centerRad: 9 }
    expect(firstContact('outer', 7, 10, [later, first])?.obstacle).toBe(first)
  })
})

describe('single-obstacle game', () => {
  it.each([30, 60, 120])('stops on the first contact at %i Hz', hz => {
    const game = running()
    frames(game, 1000, 3100, hz)
    const result = game.getSnapshot()
    expect(result.state).toBe('GAME_OVER')
    expect(result.survivalMs).toBeCloseTo(timing.firstSafeMs, 9)
    expect(result.collision?.lane).toBe('inner')
  })
  it('checks the old lane before a switch exactly at first contact', () => {
    const game = running()
    frames(game, 1000, 2900)
    game.dispatch('switch', 3000)
    expect(game.getSnapshot()).toMatchObject({ state: 'GAME_OVER', lane: 'inner' })
  })
  it('checks the destination immediately on switching into an obstacle', () => {
    const game = running()
    game.dispatch('switch', 1000)
    frames(game, 1000, 3010)
    expect(game.getSnapshot().state).toBe('RUNNING')
    game.dispatch('switch', 3010)
    expect(game.getSnapshot()).toMatchObject({ state: 'GAME_OVER', lane: 'inner', survivalMs: 2010 })
  })
  it.each([30, 60, 120])('keeps an accumulated angle across switches and revolutions at %i Hz', hz => {
    const game = running()
    frames(game, 1000, 1500, hz)
    const before = game.getSnapshot()
    game.dispatch('switch', 1500)
    expect(game.getSnapshot().angleRad).toBe(before.angleRad)
    expect(before.angleRad).toBe(500 * speed)
    frames(game, 1500, 6000, hz)
    expect(game.getSnapshot().angleRad).toBeCloseTo(2 * Math.PI, 12)
    game.dispatch('switch', 6000)
    frames(game, 6000, 11000, hz)
    expect(game.getSnapshot()).toMatchObject({ state: 'RUNNING', survivalMs: 10000, visibleObstacles: [] })
    expect(game.getSnapshot().angleRad).toBeCloseTo(4 * Math.PI, 12)
  })
  it('shows the first obstacle early enough and removes it after its contact interval', () => {
    const game = running()
    game.dispatch('switch', 1000)
    frames(game, 1000, 1199)
    expect(game.getSnapshot().visibleObstacles).toHaveLength(0)
    frames(game, 1199, 1250)
    expect(game.getSnapshot().visibleObstacles).toHaveLength(1)
    frames(game, 1250, 3500)
    expect(game.getSnapshot().visibleObstacles).toHaveLength(0)
  })
  it('uses result entry time for the retry lock and resets the round once', () => {
    const game = running()
    frames(game, 1000, 2990)
    game.dispatch('retry', 3100)
    expect(game.getSnapshot().survivalMs).toBeCloseTo(2000, 9)
    game.dispatch('retry', 3399)
    expect(game.getSnapshot()).toMatchObject({ state: 'GAME_OVER', canRetry: false })
    game.dispatch('retry', 3400)
    expect(game.getSnapshot()).toMatchObject({ state: 'COUNTDOWN', survivalMs: 0, collision: null, lane: 'inner' })
    frames(game, 3400, 4400)
    expect(game.getSnapshot()).toMatchObject({ state: 'RUNNING', survivalMs: 0 })
  })
  it('freezes while hidden and preserves lane and time across a manual resume', () => {
    const game = running()
    game.dispatch('switch', 1200)
    game.dispatch('pause', 1250)
    game.update(30000)
    expect(game.getSnapshot()).toMatchObject({ state: 'PAUSED', lane: 'outer', survivalMs: 250, canRetry: true })
    game.dispatch('resume', 30000)
    frames(game, 30000, 30999)
    expect(game.getSnapshot()).toMatchObject({ state: 'COUNTDOWN', countdownRemainingMs: 1, survivalMs: 250 })
    game.update(31010)
    expect(game.getSnapshot()).toMatchObject({ state: 'RUNNING', survivalMs: 260, lane: 'outer' })
  })
  it('accepts a 250ms gap and safely pauses on a longer gap without applying the pending command', () => {
    const game = running()
    game.update(1250)
    expect(game.getSnapshot()).toMatchObject({ state: 'RUNNING', survivalMs: 250 })
    game.dispatch('resume', 1501)
    expect(game.getSnapshot()).toMatchObject({ state: 'PAUSED', survivalMs: 250 })
    game.dispatch('retry', 1502)
    expect(game.getSnapshot()).toMatchObject({ state: 'COUNTDOWN', survivalMs: 0 })
  })
  it('ignores non-finite or stale commands and consumes start only in READY', () => {
    const game = running()
    game.update(1100)
    for (const time of [NaN, Infinity, 900]) game.dispatch('switch', time)
    game.dispatch('start', 1100)
    expect(game.getSnapshot()).toMatchObject({ state: 'RUNNING', lane: 'inner', survivalMs: 100 })
  })
})
