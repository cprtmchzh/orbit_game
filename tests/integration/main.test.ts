import { afterEach, expect, it, vi } from 'vitest'
import type { BindInput, GameSnapshot, RecordView } from '../../src/contracts'

const ui = vi.hoisted(() => ({
  render: vi.fn<(snapshot: GameSnapshot, record: RecordView) => void>(),
  bind: vi.fn<BindInput>(() => () => {}),
}))
vi.mock('../../src/input', () => ({ bindInput: ui.bind }))
vi.mock('../../src/ui', () => ({
  createView: () => ({ controls: {}, render: ui.render, destroy: () => {} }),
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('wires a single loop from start through pause, result storage and retry', async () => {
  const doc = Object.assign(new EventTarget(), { hidden: false, querySelector: () => ({}) })
  const storage = { getItem: vi.fn(() => null), setItem: vi.fn() }
  let clock = 0
  let pending: FrameRequestCallback | undefined
  function advance(ms: number) {
    clock += ms
    const callback = pending
    pending = undefined
    expect(callback).toBeTypeOf('function')
    callback!(clock)
  }
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', { localStorage: storage })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    expect(pending).toBeUndefined()
    pending = callback
    return 1
  })
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  await import('../../src/main')
  const send = ui.bind.mock.calls[0][2]
  const last = () => ui.render.mock.lastCall!
  expect(last()[0].state).toBe('READY')
  send('start')
  for (let i = 0; i < 5; i++) advance(200)
  expect(last()[0].state).toBe('RUNNING')
  send('switch')
  expect(last()[0].lane).toBe('outer')
  doc.hidden = true
  doc.dispatchEvent(new Event('visibilitychange'))
  advance(7500)
  doc.hidden = false
  doc.dispatchEvent(new Event('visibilitychange'))
  expect(last()[0]).toMatchObject({ state: 'PAUSED', lane: 'outer', survivalMs: 0 })
  send('resume')
  for (let i = 0; i < 5; i++) advance(200)
  expect(last()[0]).toMatchObject({ state: 'RUNNING', lane: 'outer', survivalMs: 0 })
  send('switch')
  for (let i = 0; i < 10; i++) advance(200)
  expect(last()[0]).toMatchObject({ state: 'GAME_OVER', lane: 'inner', canRetry: false })
  expect(last()[1]).toEqual({ bestTimeMs: 2000, isNewBest: true })
  send('retry')
  expect(last()[0].state).toBe('GAME_OVER')
  advance(300)
  expect(storage.setItem).toHaveBeenCalledTimes(1)
  send('retry')
  for (let i = 0; i < 5; i++) advance(200)
  expect(last()[0]).toMatchObject({ state: 'RUNNING', lane: 'inner', survivalMs: 0 })
  expect(last()[1]).toEqual({ bestTimeMs: 2000, isNewBest: false })
  advance(251)
  expect(last()[0]).toMatchObject({ state: 'PAUSED', survivalMs: 0 })
  expect(ui.bind).toHaveBeenCalledTimes(1)
})
