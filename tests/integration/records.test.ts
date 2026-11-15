import { expect, it } from 'vitest'
import { createRecordStore, recordKey } from '../../src/storage'
import type { PlayableChart } from '../../src/contracts'

it('keeps the best catch score in memory when persistence throws', () => {
  const store = createRecordStore(() => { throw new Error('denied') })
  store.finish('a', 5, 10)
  store.finish('a', 2, 10)
  expect(store.read('a')).toEqual({ hits: 5, totalNotes: 10, perfect: false })
  store.finish('a', 10, 10)
  store.finish('a', 3, 10)
  expect(store.read('a')).toEqual({ hits: 10, totalNotes: 10, perfect: true })
  expect(store.read('b')).toBeUndefined()
})

it('ignores malformed or incompatible records and restores the best score on a new visit', () => {
  const data = new Map<string, string>()
  const backend = () => ({
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  })
  const store = createRecordStore(backend)
  for (const raw of ['bad JSON', '{"progress":1,"cleared":true}', '{"version":2,"hits":9,"totalNotes":10,"perfect":false}']) {
    data.set('song', raw)
    expect(store.read('song')).toBeUndefined()
  }
  store.finish('song', 7, 10)
  expect(createRecordStore(backend).read('song')).toEqual({ hits: 7, totalNotes: 10, perfect: false })
})

it('separates rules, versions, audio, chart data and parts while ignoring part selection order', () => {
  const chart:PlayableChart={source:{schemaVersion:2,songId:'song',title:'Song',chartVersion:'1',
    audioDurationSec:10,offsetSec:0,defaultTrackIds:['a'],tracks:[],notes:[]},
    selectedTrackIds:['a','b'],lanes:[],heads:[],audioEndSec:10,excludedTracks:[]}
  const key=recordKey(chart,'audio','chart')
  expect(key).toMatch(/^orbit-switch:catch:v1:/)
  expect(recordKey({...chart,selectedTrackIds:['b','a']},'audio','chart')).toBe(key)
  expect(recordKey({...chart,selectedTrackIds:['a']},'audio','chart')).not.toBe(key)
  expect(recordKey(chart,'other','chart')).not.toBe(key)
  expect(recordKey(chart,'audio','other')).not.toBe(key)
  expect(recordKey({...chart,source:{...chart.source,chartVersion:'2'}},'audio','chart')).not.toBe(key)
})
