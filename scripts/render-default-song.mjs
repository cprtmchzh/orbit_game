// Render the original score to PCM and chart data together. Run from any directory with Node 24.
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

const folder = new URL('../public/songs/', import.meta.url)
const bpm = 120
const beat = 60 / bpm
const sampleRate = 22050
const durationSec = 12
// Six four-beat bars. Each tuple gives beat within bar, MIDI pitch, and duration in beats.
const bars = [
  [[0,69,0.85],[1,72,0.42],[1.5,76,0.42],[2,72,1.5]],
  [[0,67,0.85],[1,69,0.85],[2,64,0.85],[3,67,0.85]],
  [[0,69,1.4],[1.5,72,0.42],[2,76,0.85],[3,72,0.85]],
  [[0,67,0.42],[0.5,64,0.42],[1,67,0.85],[2,69,1.5]],
  [[0,76,0.85],[1,72,0.85],[2,69,0.42],[2.5,67,0.42],[3,64,0.85]],
  [[0,67,0.85],[1,72,0.85],[2,69,1.8]],
]
const notes = bars.flatMap((bar,b) => bar.map(([at,pitch,length],i) => ({
  id: 'bar'+(b+1)+'-note'+(i+1), trackId:'melody', pitch,
  startSec: (4*b+at)*beat, durationSec: length*beat,
})))
const data = Buffer.alloc(sampleRate*durationSec*2)
for (const note of notes) {
  const start = Math.round(note.startSec*sampleRate)
  const count = Math.round(note.durationSec*sampleRate)
  const hz = 440 * 2**((note.pitch-69)/12)
  for (let i=0;i<count;i++) {
    const t=i/sampleRate, phase=2*Math.PI*hz*t
    const envelope=Math.min(1,t/0.006,(count-1-i)/(sampleRate*0.055))*Math.exp(-1.15*t)
    const wave=(Math.sin(phase)+0.24*Math.sin(2*phase)+0.08*Math.sin(3*phase))*0.52
    data.writeInt16LE(Math.round(32767*envelope*wave),(start+i)*2)
  }
}
const header=Buffer.alloc(44)
header.write('RIFF',0); header.writeUInt32LE(36+data.length,4); header.write('WAVEfmt ',8)
header.writeUInt32LE(16,16); header.writeUInt16LE(1,20); header.writeUInt16LE(1,22)
header.writeUInt32LE(sampleRate,24); header.writeUInt32LE(sampleRate*2,28)
header.writeUInt16LE(2,32); header.writeUInt16LE(16,34); header.write('data',36)
header.writeUInt32LE(data.length,40)
const wav=Buffer.concat([header,data])
const chart={schemaVersion:2,songId:'glass-steps',title:'유리 계단',chartVersion:'1',audioDurationSec:durationSec,
  offsetSec:0,audioHash:createHash('sha256').update(wav).digest('hex'),defaultTrackIds:['melody'],
  tracks:[{id:'melody',name:'멜로디',kind:'pitched'}],notes}
await mkdir(folder,{recursive:true})
await writeFile(new URL('glass-steps.wav',folder),wav)
await writeFile(new URL('glass-steps.json',folder),JSON.stringify(chart,null,2)+'\n')
console.log(chart.title,notes.length+' notes',durationSec+' seconds',chart.audioHash)
