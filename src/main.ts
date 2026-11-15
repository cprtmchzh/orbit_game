/// <reference types="vite/client" />
import { createTransport } from './audio'
import { buildChart } from './chart'
import type { GameCommand, GameController, GameState, PlayableChart } from './contracts'
import { createGame } from './game'
import { decodeSong, loadDefault, prepareSong, type Song } from './songs'
import { createRecordStore, recordKey } from './storage'
import { createUI } from './ui'

interface Selection {
  song: Song
  buffer: AudioBuffer
  tracks: readonly string[]
  chart?: PlayableChart
}

const host = document.querySelector<HTMLElement>('#app')
if (!host) throw new Error('게임을 표시할 #app 요소를 찾을 수 없습니다.')

const songs = new Map<string, Song>()
const store = createRecordStore()
let active: Selection | undefined
let draft: Selection | undefined
let game: GameController | undefined
let previousState: GameState = 'READY'
let best = { progress: 0, cleared: false }
let scoreKey = ''
let busy = false
let error = ''
let context: AudioContext | undefined
let transport: ReturnType<typeof createTransport> | undefined
let lastFrame: number | undefined
let requestGeneration = 0
const listeners = new AbortController()

function describe(cause: unknown) {
  return cause instanceof Error ? cause.message : '요청을 처리할 수 없습니다.'
}

function audioContext() {
  if (!context) {
    context = new AudioContext()
    transport = createTransport(context)
    context.addEventListener('statechange', () => {
      if (context?.state !== 'running') pause(true)
    }, { signal: listeners.signal })
  }
  return context
}

function showLibrary() {
  const chosen = draft ?? active
  ui.library({
    songs: [...songs.values()], selectedId: chosen?.song.id, source: chosen?.song.source,
    selectedTrackIds: chosen?.tracks, preview: chosen?.chart, importing: !!draft, busy, error,
    pathVerified: !!chosen && !chosen.song.local && chosen.tracks.length === 1 && chosen.tracks[0] === 'melody',
  })
}

function select(song: Song, buffer: AudioBuffer): Selection {
  const tracks = song.selectedTracks
  return { song, buffer, tracks, chart: buildChart(song.source, tracks, buffer.duration) }
}

async function libraryTask(work: () => Promise<void>) {
  if (busy || game) return
  busy = true
  error = ''
  showLibrary()
  try { await work() } catch (cause) { error = describe(cause) }
  finally { busy = false; if (!game) showLibrary() }
}

function present() {
  const chart = active?.chart
  if (!game || !chart) return
  const snapshot = game.getSnapshot()
  if ((snapshot.state === 'FAILED' || snapshot.state === 'CLEARED') && snapshot.state !== previousState) {
    transport?.stop(snapshot.songSec)
    best = store.finish(scoreKey, snapshot.progress, snapshot.state === 'CLEARED')
  }
  previousState = snapshot.state
  ui.play(chart, snapshot, best.progress, best.cleared)
}

function pause(useLastFrame: boolean) {
  if (!game || !transport) return
  const previous = game.getSnapshot()
  if (!['LEAD_IN', 'PLAYING', 'RESUMING'].includes(previous.state)) return
  const clock = useLastFrame ? { songSec: previous.songSec, resumeRemainingSec: previous.resumeRemainingSec } : transport.sample()
  game.dispatch('pause', clock)
  transport.stop(game.getSnapshot().songSec)
  present()
}

async function start(command: 'start'|'retry'|'resume') {
  const selected = active
  if (busy || draft || !selected?.chart) return
  const state = game?.getSnapshot().state
  if ((command === 'start' && game) || (command === 'resume' && state !== 'PAUSED') ||
      (command === 'retry' && state !== 'FAILED' && state !== 'CLEARED' && state !== 'PAUSED')) return
  busy = true
  const generation = ++requestGeneration
  try {
    const audio = audioContext()
    // The resume request must begin in the user's event handler, before awaiting other work.
    if (audio.state !== 'running') await audio.resume()
    if (requestGeneration !== generation || document.hidden) return
    if (!transport || audio.state !== 'running') throw new Error('음악 재생 권한을 확인하고 다시 시작하세요.')
    const clock = command === 'resume' ? transport.resume(selected.buffer) : transport.start(selected.buffer)
    if (command === 'start') {
      game = createGame(selected.chart)
      scoreKey = recordKey(selected.chart, selected.song.audioHash, selected.song.chartHash)
      best = store.read(scoreKey)
    }
    game!.dispatch(command, clock)
    lastFrame = performance.now()
    ui.error('')
    present()
  } catch (cause) {
    transport?.stop(game?.getSnapshot().songSec)
    ui.error('음악을 시작할 수 없습니다. ' + describe(cause))
  } finally {
    if (requestGeneration === generation) busy = false
  }
}

function backToLibrary() {
  requestGeneration++
  busy = false
  transport?.stop()
  game = undefined
  previousState = 'READY'
  lastFrame = undefined
  error = ''
  showLibrary()
}

function guardFrameGap(now: number) {
  if (lastFrame !== undefined && now - lastFrame > 250) {
    pause(true)
    lastFrame = now
    return true
  }
  return false
}

const ui = createUI(host, {
  selectSong(id) {
    if (active?.song.id === id || !songs.has(id)) return
    void libraryTask(async () => {
      const song = songs.get(id)!
      active = select(song, await decodeSong(audioContext(), song.encoded, song.source))
      draft = undefined
    })
  },
  selectTracks(ids) {
    const selected = draft ?? active
    if (busy || game || !selected) return
    selected.tracks = ids
    selected.chart = undefined
    error = ''
    try {
      selected.chart = buildChart(selected.song.source, ids, selected.buffer.duration)
      selected.song.selectedTracks = ids
    } catch (cause) { error = describe(cause) }
    showLibrary()
  },
  inspectFiles(audio, json) {
    void libraryTask(async () => {
      const prepared = await prepareSong(audioContext(), audio, json, true)
      // A default part may be unsuitable even when another combination is playable.
      draft = { ...prepared, tracks: prepared.song.selectedTracks }
      draft.chart = buildChart(draft.song.source, draft.tracks, draft.buffer.duration)
    })
  },
  registerSong() {
    if (!draft?.chart || busy) return
    songs.set(draft.song.id, draft.song)
    active = draft
    draft = undefined
    error = ''
    showLibrary()
  },
  cancelImport() { draft = undefined; error = ''; showLibrary() },
  command(command: GameCommand) {
    if (command === 'start' || command === 'retry' || command === 'resume') { void start(command); return }
    if (!game || !transport || busy || document.hidden) return
    if (guardFrameGap(performance.now())) return
    if (command === 'pause') pause(false)
    else { game.dispatch(command, transport.sample()); present() }
  },
  backToLibrary,
})

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (busy && game) { requestGeneration++; busy = false }
    pause(true)
  }
}, { signal: listeners.signal })

function frame(now: number) {
  if (game && transport && !document.hidden && !guardFrameGap(now)) {
    game.update(transport.sample())
    present()
  }
  lastFrame = now
  frameId = requestAnimationFrame(frame)
}
let frameId = requestAnimationFrame(frame)

void libraryTask(async () => {
  const prepared = await loadDefault(audioContext())
  active = select(prepared.song, prepared.buffer)
  songs.set(prepared.song.id, prepared.song)
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    requestGeneration++
    cancelAnimationFrame(frameId)
    listeners.abort()
    transport?.stop()
    void context?.close()
    ui.destroy()
  })
}
