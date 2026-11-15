import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameCommand, GameSnapshot, ViewControls } from '../../src/contracts'
import { bindInput } from '../../src/input'

class TestButton extends EventTarget {
  disabled = false
  hidden = false
  closest() { return null }
}

function inputFixture() {
  const document = new EventTarget()
  const canvas = Object.assign(new EventTarget(), { ownerDocument: document })
  const buttons = {
    start: new TestButton(), pause: new TestButton(), resume: new TestButton(),
    retry: new TestButton(), restart: new TestButton(),
  }
  const controls = { ...buttons, canvas } as unknown as ViewControls
  let state: GameSnapshot['state'] = 'RUNNING'
  let canRetry = false
  const commands: GameCommand[] = []
  const send = (command: GameCommand) => { commands.push(command) }
  const bind = () => bindInput(controls, () => ({
    state, canRetry, angleRad: 0, survivalMs: 0, countdownRemainingMs: 0,
    visibleObstacles: [], lane: 'inner', collision: null,
  }), send)
  function emit(target: EventTarget, type: string, properties: Record<string, unknown>) {
    const event = Object.assign(new Event(type, { cancelable: true }), properties)
    target.dispatchEvent(event)
    return event
  }
  return {
    commands, buttons, bind,
    state(next: typeof state, allowed = false) { state = next; canRetry = allowed },
    key(key = ' ', repeat = false) { return emit(document, 'keydown', { key, repeat }) },
    pointer(isPrimary: boolean, button = 0) { emit(canvas, 'pointerdown', { isPrimary, button }) },
    clickCanvas() { emit(canvas, 'click', {}) },
  }
}

describe('단일 게임 입력', () => {
  beforeEach(() => {
    vi.stubGlobal('Element', TestButton)
    vi.stubGlobal('HTMLButtonElement', TestButton)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('주 포인터를 한 번 수용하고 두 번째 손가락·오른쪽 버튼·합성 클릭을 무시한다', () => {
    const f = inputFixture()
    f.bind()
    f.pointer(true)
    f.clickCanvas()
    f.pointer(false)
    f.pointer(true, 2)
    expect(f.commands).toEqual(['switch'])
  })

  it('준비 중 입력과 누르고 있는 스페이스를 다음 판으로 넘기지 않는다', () => {
    const f = inputFixture()
    f.bind()
    f.state('READY')
    expect(f.key().defaultPrevented).toBe(true)
    f.state('COUNTDOWN')
    f.key()
    f.pointer(true)
    f.state('RUNNING')
    f.key(' ', true)
    f.key()
    expect(f.commands).toEqual(['start', 'switch'])
  })

  it('결과 잠금이 풀린 뒤의 새 입력만 재도전으로 보낸다', () => {
    const f = inputFixture()
    f.bind()
    f.state('GAME_OVER')
    f.key()
    f.buttons.retry.dispatchEvent(new Event('click'))
    f.state('GAME_OVER', true)
    f.key(' ', true)
    f.key()
    expect(f.commands).toEqual(['retry'])
  })

  it('버튼과 Esc를 각각 현재 상태의 한 명령으로 처리한다', () => {
    const f = inputFixture()
    f.bind()
    f.state('READY')
    f.buttons.start.dispatchEvent(new Event('click'))
    f.state('RUNNING')
    f.key('Escape')
    f.state('PAUSED', true)
    f.buttons.resume.dispatchEvent(new Event('click'))
    f.buttons.restart.dispatchEvent(new Event('click'))
    expect(f.commands).toEqual(['start', 'pause', 'resume', 'retry'])
  })

  it('입력 해제·재연결 후 이전 리스너를 호출하지 않는다', () => {
    const f = inputFixture()
    const release = f.bind()
    release()
    f.pointer(true)
    f.bind()
    f.pointer(true)
    expect(f.commands).toEqual(['switch'])
  })
})
