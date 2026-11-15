import { expect, it } from 'vitest'
import { createRecordStore, recordKey } from '../../src/storage'
import type { PlayableChart } from '../../src/contracts'

it('keeps fallback progress and clear status when persistence throws',()=>{
  const store=createRecordStore(()=>{throw new Error('denied')})
  store.finish('a',.5,false);store.finish('a',.2,false)
  expect(store.read('a')).toEqual({progress:.5,cleared:false})
  store.finish('a',1,true);store.finish('a',.3,false)
  expect(store.read('a')).toEqual({progress:1,cleared:true})
  expect(store.read('b')).toEqual({progress:0,cleared:false})
})
it('recovers from a malformed stored value and restores progress on a new visit',()=>{
  const data=new Map<string,string>([['song','bad JSON']])
  const backend=()=>({getItem:(key:string)=>data.get(key)??null,setItem:(key:string,raw:string)=>data.set(key,raw)})
  const store=createRecordStore(backend)
  expect(store.read('song').progress).toBe(0)
  store.finish('song',.7,false)
  expect(createRecordStore(backend).read('song')).toEqual({progress:.7,cleared:false})
})
it('separates versions, audio, chart data and parts while ignoring part selection order',()=>{
  const chart:PlayableChart={source:{schemaVersion:2,songId:'song',title:'Song',chartVersion:'1',
    audioDurationSec:10,offsetSec:0,defaultTrackIds:['a'],tracks:[],notes:[]},
    selectedTrackIds:['a','b'],lanes:[],heads:[],audioEndSec:10,excludedTracks:[]}
  const key=recordKey(chart,'audio','chart')
  expect(recordKey({...chart,selectedTrackIds:['b','a']},'audio','chart')).toBe(key)
  expect(recordKey({...chart,selectedTrackIds:['a']},'audio','chart')).not.toBe(key)
  expect(recordKey(chart,'other','chart')).not.toBe(key)
  expect(recordKey(chart,'audio','other')).not.toBe(key)
  expect(recordKey({...chart,source:{...chart.source,chartVersion:'2'}},'audio','chart')).not.toBe(key)
})
