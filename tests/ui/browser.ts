import { createUI } from '../../src/ui'
import type { GameSnapshot, PlayableChart, VisibleHead } from '../../src/contracts'
import { geometry } from '../../src/config'
import type { LibraryView } from '../../src/ui'

const root = document.querySelector<HTMLElement>('#test')!
const report = document.querySelector<HTMLOutputElement>('output')!
const passed: string[] = []
function assert(name: string, success: boolean) {
  if (!success) throw new Error(name)
  passed.push(name)
}
function run() {
  const chart: PlayableChart = {
    source: { schemaVersion: 2, songId: 'test', chartVersion: '1', title: '<b>테스트</b>', audioDurationSec: 18,
      offsetSec: 0, defaultTrackIds: ['m'], tracks: [{ id: 'm', name: '멜로디', kind: 'pitched' },
        { id: 'd', name: '드럼', kind: 'drums' }], notes: [] },
    selectedTrackIds: ['m'], lanes: [{ index: 0, pitch: 72, y: 80 }, { index: 1, pitch: 61, y: 380 }],
    heads: [{ sourceIds: ['n0'], pitch: 72, laneIndex: 0, arrivalSec: 0, durationSec: 0.3 }],
    audioEndSec: 18, excludedTracks: [{ trackId: 'd', noteCount: 2, reason: 'drums' }]
  }
  const head: VisibleHead = { note: chart.heads[0], x: geometry.width - geometry.headRadius, y: 80, radius: geometry.headRadius }
  const frame: GameSnapshot = { state: 'LEAD_IN', songSec: -2, resumeRemainingSec: 0, progress: 0,
    player: { x: geometry.playerX, y: 144, radius: geometry.playerRadius }, movement: null,
    queuedDirection: null, visibleHeads: [head], collision: null }
  const model: LibraryView = { songs: [{ id: 'local', title: chart.source.title, local: true }], selectedId: 'local',
    source: chart.source, preview: chart, selectedTrackIds: ['m'] }
  const actions: string[] = []
  const ui = createUI(root, { selectSong: id => actions.push(id), selectTracks: ids => actions.push(ids.join(',')),
    inspectFiles: (a, b) => actions.push(a.name + '+' + b.name), registerSong: () => actions.push('register'),
    cancelImport: () => actions.push('cancel'), command: c => actions.push(c), backToLibrary: () => actions.push('back') })
  const get = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!
  const button = (s: string) => get<HTMLButtonElement>(s)
  const key = (value: string, repeat = false) => window.dispatchEvent(new KeyboardEvent('keydown', { key: value, repeat, bubbles: true }))
  ui.library(model)
  assert('metadata displayed as text', get('[data-title]').textContent === chart.source.title && !get('[data-title]').children.length)
  assert('session and route status', get('.song-list').textContent!.includes('세션 곡') && get('[data-verified]').textContent!.includes('미검증'))
  assert('duration, lane count and excluded parts', get('[data-duration]').textContent!.includes('0:18') &&
    get('[data-preview]').textContent!.includes('2개 레인') && get('[data-excluded]').textContent!.includes('2음'))
  button('[data-add]').click()
  for (const [selector, filename] of [['[data-audio]', 'a.wav'], ['[data-chart]', 'c.json']]) {
    const dt = new DataTransfer()
    dt.items.add(new File(['fixture'], filename))
    get<HTMLInputElement>(selector).files = dt.files
  }
  get<HTMLFormElement>('form').requestSubmit()
  assert('file pair delivered', actions.at(-1) === 'a.wav+c.json')
  ui.library({ ...model, error: '잘못된 JSON' })
  assert('file errors are announced', !get('[role=alert]').hidden && get('[role=alert]').textContent === '잘못된 JSON')
  ui.library({ ...model, importing: true })
  button('[data-register]').click()
  assert('preview before register', actions.at(-1) === 'register' && button('[data-command=start]').hidden)
  ui.library(model)
  const moving = () => actions.filter(a => a === 'up' || a === 'down')
  ui.play(chart, frame)
  key('ArrowUp'); key('ArrowUp', true)
  const down = button('[data-command=down]')
  down.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', isPrimary: true }))
  down.click()
  assert('one command per key/activation', moving().join(',') === 'up,down')
  const c = get<HTMLCanvasElement>('canvas')
  const pixel = (x: number, y: number) => {
    const px = Math.min(c.width - 1, Math.round(x * c.width / geometry.width))
    const py = Math.min(c.height - 1, Math.round(y * c.height / geometry.height))
    return c.getContext('2d')!.getImageData(px, py, 1, 1).data
  }
  const noteColor = pixel(head.x, head.y), player = pixel(frame.player.x, frame.player.y)
  assert('0s note shown at lead-in boundary', noteColor[0] >= 220 && noteColor[1] >= 220)
  assert('player rendered at snapshot y between lanes', player[1] > player[0] && player[0] < 100 && player[1] > 25)
  key('Escape')
  assert('escape sends pause', actions.at(-1) === 'pause')
  ui.play(chart, { ...frame, state: 'PAUSED' })
  key('ArrowDown')
  button('[data-command=resume]').click()
  assert('pause and resume actions', moving().length === 2 && actions.at(-1) === 'resume')
  ui.play(chart, { ...frame, state: 'RESUMING', resumeRemainingSec: 0.6 })
  assert('resume countdown', get('[data-clock]').textContent!.includes('1초'))
  ui.play(chart, { ...frame, state: 'FAILED', songSec: 4, progress: 0.2,
    collision: { songSec: 4, player: frame.player, noteHead: head } }, 0.5, true)
  button('[data-command=retry]').click()
  assert('failure and retry', get('[data-result]').textContent!.includes('4.00초') && actions.at(-1) === 'retry')
  ui.play(chart, { ...frame, state: 'CLEARED', songSec: 18, progress: 1 }, 1, true)
  assert('clear and best', get('[data-status]').textContent === '클리어' && get('[data-result]').textContent!.includes('최고 100%'))
  assert('layout within viewport', root.scrollWidth <= document.documentElement.clientWidth)
  ui.destroy()
  key('ArrowUp')
  assert('input cleanup', moving().length === 2 && !root.children.length)
}

try {
  run()
  report.textContent = 'PASS ' + passed.length + ' at ' + innerWidth + '×' + innerHeight + ' ' + passed.join(' / ')
} catch (error) {
  report.textContent = 'FAIL after ' + passed.length + ' · ' + String(error)
  throw error
}
