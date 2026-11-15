import type { GameSnapshot, GameView, RecordView } from './contracts'
import { renderScene } from './renderer'
import './style.css'

function seconds(ms: number): string {
  return (Math.floor(ms / 100) / 10).toFixed(1)
}

export function createView(host: HTMLElement): GameView {
  const page = host.ownerDocument.createElement('section')
  page.className = 'orbit-game'
  page.innerHTML = `
    <header class="orbit-header">
      <h1><span class="orbit-mark" aria-hidden="true"></span>궤도 스위치</h1>
      <div class="orbit-best">최고 기록 <b data-best>0.0초</b></div>
    </header>
    <div class="orbit-board">
      <canvas aria-label="두 궤도 위 플레이어와 장애물. 플레이 중 누르면 궤도가 바뀝니다."></canvas>
      <div class="orbit-clock" aria-hidden="true"><span data-caption></span><strong data-clock></strong></div>
    </div>
    <section class="orbit-panel">
      <div class="orbit-message" role="status"><h2 data-heading></h2><p data-detail></p></div>
      <div class="orbit-actions">
        <button type="button" data-action="start">게임 시작</button>
        <button type="button" data-action="pause">일시정지</button>
        <button type="button" data-action="resume">계속하기</button>
        <button type="button" data-action="restart" class="orbit-secondary">다시 시작</button>
        <button type="button" data-action="retry">재도전</button>
      </div>
    </section>`
  host.replaceChildren(page)
  function select<T extends HTMLElement>(selector: string): T {
    const element = page.querySelector<T>(selector)
    if (!element) throw new Error('게임 화면 요소가 없습니다. ' + selector)
    return element
  }
  const canvas = select<HTMLCanvasElement>('canvas')
  const button = (name: string) => select<HTMLButtonElement>(`[data-action="${name}"]`)
  const controls = { canvas, start: button('start'), pause: button('pause'), resume: button('resume'),
    restart: button('restart'), retry: button('retry') }
  const best = select('[data-best]')
  const caption = select('[data-caption]')
  const clock = select('[data-clock]')
  const heading = select('[data-heading]')
  const detail = select('[data-detail]')
  function label(node: HTMLElement, value: string): void {
    if (node.textContent !== value) node.textContent = value
  }
  function render(snapshot: GameSnapshot, record: RecordView): void {
    const { state, survivalMs, countdownRemainingMs, canRetry } = snapshot
    const ready = state === 'READY'
    const counting = state === 'COUNTDOWN'
    const playing = state === 'RUNNING'
    const paused = state === 'PAUSED'
    const ended = state === 'GAME_OVER'
    page.dataset.state = state
    label(best, seconds(record.bestTimeMs) + '초')
    label(caption, counting ? '준비' : ready ? '' : '생존 시간')
    label(clock, counting ? String(Math.ceil(countdownRemainingMs / 1000)) : ready ? '' : seconds(survivalMs) + '초')
    label(heading, ended ? (record.isNewBest ? '신기록!' : '게임 종료') : paused ? '일시정지' : '')
    label(detail, ready ? '누르면 궤도가 바뀝니다. 장애물을 피해 오래 버티세요.'
      : ended ? '이번 기록 ' + seconds(survivalMs) + '초' : '')
    controls.start.hidden = !ready
    controls.pause.hidden = !playing
    controls.resume.hidden = !paused
    controls.restart.hidden = !paused
    controls.retry.hidden = !ended
    controls.retry.disabled = !canRetry
    controls.restart.disabled = !canRetry
    renderScene(canvas, snapshot)
  }
  return { canvas, controls, render, destroy: () => page.remove() }
}
