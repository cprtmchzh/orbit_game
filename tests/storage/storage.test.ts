import { describe, expect, it, vi } from 'vitest'
import { createRecordStore } from '../../src/storage'

const key = 'orbit-switch:v1'

function backend(initial: string | null = null) {
  let stored = initial
  return {
    getItem: vi.fn((name: string) => name === key ? stored : null),
    setItem: vi.fn((name: string, value: string) => {
      if (name === key) stored = value
    }),
  }
}

describe('local best time', () => {
  it('stores the first record as integer ms, and restores it on a fresh page', () => {
    const storage = backend()
    const store = createRecordStore(() => storage)
    expect(store.getBestTimeMs()).toBe(0)
    expect(store.finishRun(28400.8)).toEqual({ bestTimeMs: 28400, isNewBest: true })
    expect(storage.setItem).toHaveBeenCalledWith(key, '{"version":1,"bestTimeMs":28400}')
    expect(createRecordStore(() => storage).getBestTimeMs()).toBe(28400)
    expect(store.finishRun(28400.99).isNewBest).toBe(false)
    expect(store.finishRun(10).isNewBest).toBe(false)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
  })

  it.each([
    '{', 'null', '[]', 'true', '{}', '{"version":2,"bestTimeMs":15}',
    '{"version":1,"bestTimeMs":-1}', '{"version":1,"bestTimeMs":0.5}',
    '{"version":1,"bestTimeMs":"10"}', '{"version":1,"bestTimeMs":1e999}',
  ])('recovers from invalid data %s', raw => {
    const storage = backend(raw)
    const store = createRecordStore(() => storage)
    expect(store.getBestTimeMs()).toBe(0)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(store.finishRun(42).bestTimeMs).toBe(42)
  })

  it('retains a higher record written by another tab', () => {
    const storage = backend()
    const first = createRecordStore(() => storage)
    createRecordStore(() => storage).finishRun(300)
    expect(first.finishRun(200)).toEqual({ bestTimeMs: 300, isNewBest: false })
    expect(storage.setItem).toHaveBeenCalledTimes(1)
  })

  it('can play when acquiring browser storage throws', () => {
    const store = createRecordStore(() => { throw new Error('denied') })
    expect(store.finishRun(26).isNewBest).toBe(true)
    expect(store.finishRun(12)).toEqual({ bestTimeMs: 26, isNewBest: false })
  })

  it('continues in memory through read and write errors', () => {
    const storage = backend()
    storage.getItem.mockImplementation(() => { throw new Error('read denied') })
    storage.setItem.mockImplementation(() => { throw new Error('quota exceeded') })
    const store = createRecordStore(() => storage)
    expect(store.finishRun(70).isNewBest).toBe(true)
    expect(store.finishRun(60)).toEqual({ bestTimeMs: 70, isNewBest: false })
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(store.getBestTimeMs()).toBe(70)
  })

  it('rejects invalid scores without writing over the previous best', () => {
    const storage = backend('{"version":1,"bestTimeMs":25}')
    const store = createRecordStore(() => storage)
    for (const value of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) {
      expect(store.finishRun(value)).toEqual({ bestTimeMs: 25, isNewBest: false })
    }
    expect(storage.setItem).not.toHaveBeenCalled()
  })
})
