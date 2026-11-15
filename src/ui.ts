import './style.css'
import type { GameCommand, GameSnapshot, PlayableChart, SourceChart } from './contracts'
import { bindInput } from './input'
import { createRenderer, pitchLabel, readableLanes } from './renderer'

export interface UIActions {
  selectSong(id: string): void
  selectTracks(ids: string[]): void
  inspectFiles(audio: File, chart: File): void
  registerSong(): void
  cancelImport(): void
  command(command: GameCommand): void
  backToLibrary(): void
}

export interface LibraryView {
  songs: readonly { id: string; title: string; local: boolean }[]
  selectedId?: string
  source?: SourceChart
  selectedTrackIds?: readonly string[]
  preview?: PlayableChart
  importing?: boolean
  busy?: boolean
  error?: string
  pathVerified?: boolean
}

function time(sec: number) {
  const value = Math.max(0, Math.floor(sec))
  return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0')
}

function parts(chart: PlayableChart) {
  return chart.selectedTrackIds.map(id => chart.source.tracks.find(track => track.id === id)?.name ?? id).join(' + ')
}

function percent(progress: number) {
  return Math.floor(progress * 100) + '%'
}

export function createUI(root: HTMLElement, actions: UIActions) {
  const el = document.createElement('div')
  el.className = 'orbit'
  // Static markup only. Every song title, filename, track and diagnostic uses DOM text.
  el.innerHTML = `
    <header class="mast"><span class="brand-mark" aria-hidden="true">♪</span><h1>궤도 스위치</h1></header>
    <p class="notice error" id="os-error" role="alert" hidden></p>
    <section class="library" data-library>
      <div class="section-title"><h2>곡 선택</h2><button type="button" data-add>곡 추가</button></div>
      <div class="library-grid">
        <div class="song-list" role="group" aria-label="곡 목록"></div>
        <section class="selection">
          <h3 data-title>곡을 선택하세요</h3>
          <p data-duration></p>
          <fieldset data-parts><legend>연주 파트</legend><div data-tracks></div></fieldset>
          <p data-preview></p><p data-excluded></p><p data-verified></p>
          <div class="actions"><button type="button" class="primary" data-command="start">게임 시작</button>
            <button type="button" class="primary" data-register hidden>이 곡 등록</button>
            <button type="button" data-cancel hidden>등록 취소</button></div>
        </section>
      </div>
      <section class="import-panel" hidden>
        <h3>로컬 곡 등록</h3><p>음원과 같은 연주의 차트 JSON을 선택하세요. 새로고침하면 파일을 다시 선택해야 합니다.</p>
        <form><label>음원 파일<input type="file" accept="audio/*,.wav,.mp3" data-audio required></label>
        <label>음표 차트<input type="file" accept=".json,application/json" data-chart required></label>
        <div class="actions"><button class="primary" type="submit">파일 확인</button><button type="button" data-close>닫기</button></div></form>
      </section>
      <p class="instructions">↑ · ↓ 또는 W · S로 공을 옮겨 음표를 피하세요.</p>
    </section>
    <section class="stage" data-stage hidden>
      <div class="stage-title"><div><h2 data-song></h2><p data-meta></p></div>
        <button type="button" data-command="pause">일시정지</button></div>
      <div class="status-line"><h3 tabindex="-1" data-status aria-live="polite"></h3><span data-clock></span></div>
      <progress max="1" value="0" aria-label="곡 진행률"></progress>
      <canvas width="960" height="480" aria-label="음높이별 레인과 공, 다가오는 음표"></canvas>
      <p class="notice" data-size hidden>레인을 읽기 어렵습니다. 가로로 돌리거나 더 큰 화면 또는 다른 파트를 선택하세요.</p>
      <div class="move-controls"><button type="button" data-command="up" aria-label="위 레인으로 이동">↑ 위로</button>
        <button type="button" data-command="down" aria-label="아래 레인으로 이동">↓ 아래로</button></div>
      <p data-result></p>
      <div class="actions"><button type="button" class="primary" data-command="resume">계속하기</button>
        <button type="button" data-command="retry">재도전</button><button type="button" data-back>곡 선택</button></div>
    </section>`
  root.replaceChildren(el)
  const get = <T extends HTMLElement>(selector: string) => el.querySelector<T>(selector)!
  const libraryEl = get('[data-library]'), stage = get('[data-stage]')
  const errorBox = get('[role=alert]'), list = get('.song-list'), title = get('[data-title]')
  const previewLine = get('[data-preview]'), form = get<HTMLFormElement>('form'), panel = get('.import-panel')
  const fieldset = get<HTMLFieldSetElement>('[data-parts]'), tracks = get('[data-tracks]')
  const start = get<HTMLButtonElement>('[data-command=start]'), register = get<HTMLButtonElement>('[data-register]')
  const fileAudio = get<HTMLInputElement>('[data-audio]'), fileChart = get<HTMLInputElement>('[data-chart]')
  const submit = get<HTMLButtonElement>('[type=submit]'), add = get<HTMLButtonElement>('[data-add]')
  const cancel = get<HTMLButtonElement>('[data-cancel]'), close = get<HTMLButtonElement>('[data-close]')
  const canvas = get<HTMLCanvasElement>('canvas'), draw = createRenderer(canvas)
  const song = get('[data-song]'), meta = get('[data-meta]'), status = get('[data-status]')
  const clock = get('[data-clock]'), progress = get<HTMLProgressElement>('progress')
  const pause = get('[data-command=pause]'), moves = get('.move-controls'), resume = get('[data-command=resume]')
  const retry = get('[data-command=retry]'), back = get('[data-back]'), result = get('[data-result]')
  const size = get('[data-size]')
  const controller = new AbortController()
  const opts = { signal: controller.signal }

  let model: LibraryView = { songs: [] }
  let chart: PlayableChart | undefined
  let frame: GameSnapshot | undefined
  let picking = false
  let lastState: GameSnapshot['state'] | undefined
  let disposed = false

  function error(message: string) {
    errorBox.textContent = message
    errorBox.hidden = !message
  }

  function layout() {
    if (disposed) return
    const width = stage.hidden ? libraryEl.clientWidth : canvas.getBoundingClientRect().width
    const selected = stage.hidden ? model.preview : chart
    const readable = !!selected && readableLanes(selected.lanes, width)
    const warn = !!selected && !readable
    size.hidden = !warn
    if (stage.hidden) {
      start.disabled = !selected || !readable || !!model.busy || picking || !!model.importing
      previewLine.textContent = selected ? selected.lanes.length + '개 레인 · 음표 머리 ' + selected.heads.length + '개' +
        (warn ? ' · 가로로 돌리거나 더 큰 화면 또는 다른 파트를 선택하세요.' : '') : ''
    } else if (chart && frame) draw(chart, frame)
  }
  const observer = new ResizeObserver(layout)
  observer.observe(el)
  observer.observe(canvas)

  function library(next: LibraryView) {
    const active = document.activeElement
    const priorSong = active instanceof HTMLElement ? active.closest<HTMLButtonElement>('[data-song-id]')?.dataset.songId : undefined
    const priorTrack = active instanceof HTMLInputElement && tracks.contains(active) ? active.value : undefined
    model = next
    frame = undefined
    chart = undefined
    lastState = undefined
    stage.hidden = true
    libraryEl.hidden = false
    if (next.importing) picking = false
    panel.hidden = !picking
    add.hidden = picking || !!next.importing
    const busy = !!next.busy
    submit.disabled = busy
    close.disabled = busy
    add.disabled = busy
    list.replaceChildren(...next.songs.map(item => {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.songId = item.id
      button.setAttribute('aria-pressed', String(next.selectedId === item.id && !next.importing))
      button.disabled = busy || picking || !!next.importing
      const name = document.createElement('strong'), kind = document.createElement('small')
      name.textContent = item.title
      kind.textContent = item.local ? '세션 곡' : '기본곡'
      button.append(name, kind)
      return button
    }))
    const src = next.source ?? next.preview?.source
    title.textContent = src?.title ?? (busy ? '곡을 불러오는 중…' : '곡을 선택하세요')
    get('[data-duration]').textContent = src ? '재생 구간 0:00 – ' + time(next.preview?.audioEndSec ?? src.audioDurationSec) : ''
    const selected = new Set(next.selectedTrackIds ?? next.preview?.selectedTrackIds ?? src?.defaultTrackIds ?? [])
    fieldset.hidden = !src
    fieldset.disabled = busy || picking
    tracks.replaceChildren(...(src?.tracks ?? []).map(track => {
      const label = document.createElement('label'), input = document.createElement('input')
      input.type = 'checkbox'
      input.value = track.id
      input.checked = selected.has(track.id)
      input.disabled = track.kind === 'drums'
      label.append(input, document.createTextNode(track.name + (input.disabled ? ' (드럼 제외)' : '')))
      return label
    }))
    const excluded = next.preview?.excludedTracks ?? []
    get('[data-excluded]').textContent = excluded.length ? '제외 파트 · ' + excluded.map(item =>
      (src?.tracks.find(track => track.id === item.trackId)?.name ?? item.trackId) + ' (' +
      (item.reason === 'drums' ? '드럼' : '선택 안 함') + ', ' + item.noteCount + '음)').join(', ') : ''
    get('[data-verified]').textContent = next.preview ? (next.pathVerified ? '완주 경로 검증됨' : '플레이 경로 미검증') : ''
    start.hidden = !!next.importing || picking
    cancel.hidden = register.hidden = !next.importing
    register.disabled = !next.preview || busy
    cancel.disabled = busy
    error(next.error ?? '')
    layout()
    if (priorSong !== undefined) [...list.querySelectorAll('button')].find(btn => btn.dataset.songId === priorSong)?.focus()
    if (priorTrack !== undefined) [...tracks.querySelectorAll('input')].find(input => input.value === priorTrack)?.focus()
  }

  list.addEventListener('click', event => {
    const item = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-song-id]') : null
    if (item && !item.disabled) actions.selectSong(item.dataset.songId!)
  }, opts)
  tracks.addEventListener('change', () => {
    actions.selectTracks([...tracks.querySelectorAll<HTMLInputElement>('input:checked:not(:disabled)')].map(input => input.value))
  }, opts)
  add.addEventListener('click', () => { picking = true; form.reset(); library(model); fileAudio.focus() }, opts)
  close.addEventListener('click', () => { picking = false; form.reset(); actions.cancelImport(); library(model); add.focus() }, opts)
  form.addEventListener('submit', event => {
    event.preventDefault()
    const audio = fileAudio.files?.[0], json = fileChart.files?.[0]
    if (audio && json && !submit.disabled) actions.inspectFiles(audio, json)
  }, opts)
  register.addEventListener('click', () => actions.registerSong(), opts)
  cancel.addEventListener('click', () => { form.reset(); actions.cancelImport() }, opts)
  back.addEventListener('click', () => actions.backToLibrary(), opts)

  const unbind = bindInput(el, () => frame?.state, cmd => actions.command(cmd))

  function play(nextChart: PlayableChart, next: GameSnapshot, bestProgress?: number, bestCleared = false) {
    if (chart !== nextChart || stage.hidden) {
      song.textContent = nextChart.source.title
      meta.textContent = '선택 파트 · ' + parts(nextChart) + '　/　' + nextChart.lanes.length + '개 레인'
      libraryEl.hidden = true
      stage.hidden = false
      picking = false
      error('')
    }
    chart = nextChart
    frame = next
    const playing = next.state === 'PLAYING' || next.state === 'LEAD_IN'
    const ended = next.state === 'FAILED' || next.state === 'CLEARED'
    if (lastState !== next.state) {
      moves.hidden = !playing
      pause.hidden = !playing && next.state !== 'RESUMING'
      resume.hidden = next.state !== 'PAUSED'
      retry.hidden = back.hidden = !ended && next.state !== 'PAUSED'
      const labels = { READY: '시작 준비', LEAD_IN: '준비 주행 · 지금 이동할 수 있어요', PLAYING: '플레이 중',
        PAUSED: '일시정지', RESUMING: '재개 준비', FAILED: '음표에 닿았습니다', CLEARED: '클리어' }
      status.textContent = labels[next.state]
      if (ended || next.state === 'PAUSED') status.focus({ preventScroll: true })
      lastState = next.state
    }
    const shownTime = next.state === 'LEAD_IN' ? '시작까지 ' + Math.ceil(-next.songSec) + '초' :
      next.state === 'RESUMING' ? '계속하기까지 ' + Math.ceil(next.resumeRemainingSec) + '초' :
      time(next.songSec) + ' / ' + time(chart.audioEndSec)
    const line = shownTime + '　' + percent(next.progress)
    if (clock.textContent !== line) clock.textContent = line
    progress.value = next.progress
    const failure = next.collision ? '실패 ' + next.collision.songSec.toFixed(2) + '초 · ' + pitchLabel(next.collision.noteHead.note.pitch) + '　' : ''
    result.textContent = ended ? failure + '이번 진행률 ' + percent(next.progress) +
      (bestProgress === undefined ? '' : '　최고 ' + percent(bestProgress)) + (bestCleared ? ' · 클리어 기록 있음' : '') : ''
    layout()
  }

  return { library, play, error, destroy() {
    disposed = true
    controller.abort()
    unbind()
    observer.disconnect()
    el.remove()
  } }
}
