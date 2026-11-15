import { expect, it } from 'vitest'
import { buildChart, parseChart } from '../../src/chart'

const raw = {
  schemaVersion: 2, songId: 'part-test', title: 'Parts', chartVersion: '1', audioDurationSec: 4, offsetSec: 0.15,
  defaultTrackIds: ['melody'], tracks: [
    { id: 'melody', name: 'Melody', kind: 'pitched' }, { id: 'bass', name: 'Bass', kind: 'pitched' },
    { id: 'kit', name: 'Kit', kind: 'drums' },
  ],
  notes: [
    { id: 'a', trackId: 'melody', pitch: 60, startSec: 0, durationSec: 0.1 },
    { id: 'b', trackId: 'melody', pitch: 61, startSec: 1, durationSec: 0.1 },
    { id: 'c', trackId: 'melody', pitch: 72, startSec: 2, durationSec: 0.1 },
    { id: 'd', trackId: 'bass', pitch: 60, startSec: 0, durationSec: 0.2 },
    { id: 'e', trackId: 'kit', pitch: 36, startSec: 0, durationSec: 0.1 },
  ],
}

it('preserves pitch, semitone, octave, simultaneous source IDs, and excluded-track counts', () => {
  const source = parseChart(raw)
  const solo = buildChart(source)
  expect(solo.lanes.map(l => l.pitch)).toEqual([72, 61, 60])
  expect(solo.excludedTracks).toEqual([
    { trackId: 'bass', noteCount: 1, reason: 'not-selected' }, { trackId: 'kit', noteCount: 1, reason: 'drums' },
  ])
  const ensemble = buildChart(source, ['melody', 'bass', 'kit'])
  expect(ensemble.heads[0]).toMatchObject({ sourceIds: ['a', 'd'], arrivalSec: 0.15, laneIndex: 2, durationSec: 0.2 })
  expect(ensemble.source.notes).toEqual(raw.notes)
  expect(ensemble.selectedTrackIds).toEqual(['melody', 'bass'])
})

it.each([
  null, { ...raw, notes: [] }, { ...raw, notes: Array(20_001) }, { ...raw, offsetSec: Infinity },
  { ...raw, notes: [raw.notes[0], raw.notes[0]] },
  ...[{ pitch: 60.5 }, { pitch: 128 }, { durationSec: -1 }, { startSec: NaN }, { trackId: 'bad' }]
    .map(change => ({ ...raw, notes: [{ ...raw.notes[0], ...change }] })),
])('rejects malformed chart data', bad => { expect(() => parseChart(bad)).toThrow() })

it('reports unplayable or out-of-audio selections', () => {
  const source = parseChart(raw)
  for (const ids of [[], ['missing'], ['kit'], ['bass']]) expect(() => buildChart(source, ids)).toThrow()
  expect(() => buildChart(source, undefined, 1)).toThrow(/음원 범위/)
})
