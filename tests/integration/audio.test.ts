import { describe, expect, it, vi } from 'vitest'
import { createTransport } from '../../src/audio'

function setup(){
  const sources: ReturnType<typeof source>[] = []
  const source=()=>({buffer:null,connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn(),onended:null})
  const ctx={currentTime:10,state:'running',destination:{},createBufferSource(){
    const node=source();sources.push(node);return node
  }}
  return {ctx,sources,transport:createTransport(ctx as unknown as AudioContext),buffer:{duration:12} as AudioBuffer}
}
describe('audio clock',()=>{
  it('uses the same clock for the silent lead and starts the buffer at song zero',()=>{
    const {ctx,sources,transport,buffer}=setup()
    expect(transport.start(buffer)).toEqual({songSec:-2,resumeRemainingSec:0})
    expect(sources[0].start).toHaveBeenCalledWith(12,0)
    ctx.currentTime=11.5
    expect(transport.sample().songSec).toBe(-.5)
    ctx.currentTime=12
    expect(transport.sample().songSec).toBe(0)
  })
  it('cancels the pending sound and restores a paused lead after the resume hold',()=>{
    const {ctx,sources,transport,buffer}=setup()
    transport.start(buffer)
    ctx.currentTime=11.5;transport.stop()
    expect(sources[0].stop).toHaveBeenCalledTimes(1)
    ctx.currentTime=20
    expect(transport.resume(buffer)).toEqual({songSec:-.5,resumeRemainingSec:1})
    expect(sources[1].start).toHaveBeenCalledWith(21.5,0)
    ctx.currentTime=20.75
    expect(transport.sample()).toEqual({songSec:-.5,resumeRemainingSec:.25})
    ctx.currentTime=21.5
    expect(transport.sample()).toEqual({songSec:0,resumeRemainingSec:0})
  })
  it('resumes at the buffer playhead and advances after the last audio sample',()=>{
    const {ctx,sources,transport,buffer}=setup()
    transport.start(buffer)
    ctx.currentTime=17;transport.stop()
    ctx.currentTime=50;transport.resume(buffer)
    expect(sources[1].start).toHaveBeenCalledWith(51,5)
    ctx.currentTime=59
    expect(transport.sample().songSec).toBe(13)
    transport.stop(12.02);transport.resume(buffer)
    expect(sources).toHaveLength(2)
  })
  it('does not advance a round after rejected playback',()=>{
    const {ctx,sources,transport,buffer}=setup()
    ctx.state='suspended'
    expect(()=>transport.start(buffer)).toThrow()
    expect(sources).toHaveLength(0)
    ctx.currentTime=60
    expect(transport.sample().songSec).toBe(-2)
  })
})
