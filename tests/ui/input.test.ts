import { expect, it } from 'vitest'
import { keyboardCommand } from '../../src/input'
import { pitchLabel, readableLanes } from '../../src/renderer'

it('accepts movement during lead-in and gameplay and keeps the resume countdown frozen', () => {
  expect(keyboardCommand('W', 'LEAD_IN')).toBe('up')
  expect(keyboardCommand('ArrowDown', 'PLAYING')).toBe('down')
  expect(keyboardCommand('s', 'RESUMING')).toBeUndefined()
  expect(keyboardCommand('ArrowUp', 'READY')).toBeUndefined()
  expect(keyboardCommand('Escape', 'PLAYING')).toBe('pause')
  expect(keyboardCommand(' ', 'FAILED')).toBeUndefined()
})

it('keeps repeated pitch classes in distinct octaves and identifies semitones', () => {
  expect([60, 61, 72].map(pitchLabel)).toEqual(['C4', 'C♯4', 'C5'])
})

it('checks actual lane spacing at the available screen width', () => {
  const lanes = [{ index: 0, pitch: 71, y: 80 }, { index: 1, pitch: 64, y: 120 }]
  expect(readableLanes(lanes, 960)).toBe(true)
  expect(readableLanes(lanes, 320)).toBe(false)
})
