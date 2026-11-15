import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parseChart, buildChart } from '../../src/chart'
import { createGame } from '../../src/game'

// #23 owns the actual asset. An isolated core checkout can point here via ORBIT_REPLAY_CHART.
const file = process.env.ORBIT_REPLAY_CHART || new URL('../../public/songs/glass-steps.json', import.meta.url)
const moves = [
  [0.12, 'up'], [0.53, 'up'], [0.78, 'down'], [1.1, 'down'], [1.3, 'down'],
  [2.1, 'up'], [2.53, 'down'], [2.7, 'down'], [3.1, 'up'], [3.6, 'up'],
  [4.1, 'up'], [4.78, 'up'], [5.1, 'down'], [5.53, 'down'], [5.7, 'down'],
  [6.03, 'down'], [6.28, 'up'], [6.6, 'up'], [7.1, 'up'], [7.3, 'up'],
  [8.1, 'down'], [8.6, 'down'], [9.03, 'down'], [9.28, 'down'], [9.6, 'up'],
  [10.03, 'up'], [10.2, 'up'], [10.6, 'down'],
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
  expect(game.getSnapshot()).toMatchObject({ state: 'CLEARED', songSec: 12, progress: 1, hits: 24, misses: 0, totalNotes: 24 })
})
