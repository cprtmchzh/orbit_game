// Browser-only fixture. Production bootstrapping stays in src/main.ts.
import type { GameCommand, GameSnapshot, GameState } from '../../src/contracts'
import { bindInput } from '../../src/input'
import { createView } from '../../src/ui'

const states: GameState[] = ['READY', 'COUNTDOWN', 'RUNNING', 'PAUSED', 'GAME_OVER']
const state = states.find(value => value === new URLSearchParams(location.search).get('state')) ?? 'READY'
const host = document.querySelector<HTMLElement>('#app')!
const view = createView(host)
const snapshot: GameSnapshot = {
  state, lane: 'inner', angleRad: Math.PI * 1.3, survivalMs: 12345,
  countdownRemainingMs: 700, canRetry: state === 'GAME_OVER' || state === 'PAUSED',
  collision: null, visibleObstacles: [{ lane: 'outer', centerRad: 0.7 }],
}
const record = { bestTimeMs: 12345, isNewBest: state === 'GAME_OVER' }
const commands: GameCommand[] = []
function draw(value: GameSnapshot) { view.render(value, record) }
const release = bindInput(view.controls, () => snapshot, command => {
  commands.push(command)
  host.dataset.commands = JSON.stringify(commands)
})
draw(snapshot)
window.addEventListener('resize', () => draw(snapshot))
window.addEventListener('pagehide', () => { release(); view.destroy() }, { once: true })
