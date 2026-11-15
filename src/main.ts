/// <reference types="vite/client" />
import type { GameCommand, GameState, RecordView } from './contracts'
import { createGame } from './game'
import { bindInput } from './input'
import { createRecordStore } from './storage'
import { createView } from './ui'

const host = document.querySelector<HTMLElement>('#app')
if (!host) throw new Error('게임을 표시할 #app 요소를 찾을 수 없습니다.')

const game = createGame()
const view = createView(host)
const store = createRecordStore()
let record: RecordView = { bestTimeMs: store.getBestTimeMs(), isNewBest: false }
let previousState: GameState = 'READY'

function present() {
  const snapshot = game.getSnapshot()
  if (snapshot.state === 'GAME_OVER' && previousState !== 'GAME_OVER') {
    record = store.finishRun(snapshot.survivalMs)
  } else if (previousState === 'GAME_OVER' && snapshot.state !== 'GAME_OVER') {
    record = { ...record, isNewBest: false }
  }
  previousState = snapshot.state
  view.render(snapshot, record)
}

function sendCommand(command: GameCommand) {
  game.dispatch(command, performance.now())
  present()
}

function onVisibilityChange() {
  if (document.hidden) sendCommand('pause')
}

function frame() {
  // Sampling at execution keeps an input between queued frames on the same clock.
  game.update(performance.now())
  present()
  frameId = requestAnimationFrame(frame)
}

const unbind = bindInput(view.controls, game.getSnapshot, sendCommand)
document.addEventListener('visibilitychange', onVisibilityChange)
present()
let frameId = requestAnimationFrame(frame)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(frameId)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    unbind()
    view.destroy()
  })
}
