import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parseChart, buildChart } from '../../src/chart'
import { createGame } from '../../src/game'

// #23 owns the actual asset. An isolated core checkout can point here via ORBIT_REPLAY_CHART.
const file = process.env.ORBIT_REPLAY_CHART || new URL('../../public/songs/glass-steps.json', import.meta.url)
const moves = [
  [-1.5, 'up'], [-1.2, 'up'], [0.54, 'down'], [0.82, 'up'],
  [4.82, 'down'], [5.12, 'up'], [7.6, 'down'], [8.18, 'up'],
]

it.skipIf(!existsSync(file)).each([30, 60, 120, 1])('clears the shipped Glass Steps chart at %i Hz', hz => {
  const chart = buildChart(parseChart(JSON.parse(readFileSync(file, 'utf8'))))
  expect(chart.source.songId).toBe('glass-steps')
  expect(chart.heads).toHaveLength(24)
  const game = createGame(chart)
  const clock = songSec => ({ songSec, resumeRemainingSec: 0 })
  game.dispatch('start', clock(-2))
  let index = 0
  for (let frame = 0; frame <= (chart.audioEndSec + 2) * hz; frame++) {
    const t = -2 + frame / hz
    while (index < moves.length && moves[index][0] <= t) {
      const [sec, command] = moves[index++]
      game.dispatch(command, clock(sec))
    }
    game.update(clock(t))
  }
  expect(game.getSnapshot()).toMatchObject({ state: 'CLEARED', songSec: 12, progress: 1, collision: null })
})
