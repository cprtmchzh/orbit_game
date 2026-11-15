import type { BindInput, GameCommand } from './contracts'

export const bindInput: BindInput = (controls, getSnapshot, sendCommand) => {
  const { canvas, start, pause, resume, retry, restart } = controls
  const doc = canvas.ownerDocument
  const listeners = new AbortController()
  const options = { signal: listeners.signal }
  const actions = new Map<HTMLButtonElement, GameCommand>([
    [start, 'start'], [pause, 'pause'], [resume, 'resume'], [retry, 'retry'], [restart, 'retry'],
  ])

  function buttonCommand(button: HTMLButtonElement): void {
    const { state, canRetry } = getSnapshot()
    if (button.disabled || button.hidden) return
    if ((button === start && state === 'READY') || (button === pause && state === 'RUNNING')
      || (button === resume && state === 'PAUSED')
      || (button === restart && state === 'PAUSED' && canRetry)
      || (button === retry && state === 'GAME_OVER' && canRetry)) {
      sendCommand(actions.get(button)!)
    }
  }

  for (const button of actions.keys()) {
    button.addEventListener('click', () => buttonCommand(button), options)
  }
  canvas.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || getSnapshot().state !== 'RUNNING') return
    event.preventDefault()
    sendCommand('switch')
  }, options)

  doc.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.target
    if (target instanceof Element && target.closest('input,textarea,select,[contenteditable="true"],a[href]')) return
    const { state, canRetry } = getSnapshot()
    if (event.key === 'Escape' && state === 'RUNNING') {
      event.preventDefault()
      if (!event.repeat) sendCommand('pause')
      return
    }
    if (event.code !== 'Space' && event.key !== ' ') return
    // An explicitly focused button owns Space. Prevent its synthetic click and
    // consume the physical keydown now, even if the screen changes before keyup.
    if (target instanceof HTMLButtonElement && !actions.has(target)) return
    event.preventDefault()
    if (event.repeat) return
    if (target instanceof HTMLButtonElement) {
      buttonCommand(target)
    } else if (state === 'READY') {
      sendCommand('start')
    } else if (state === 'RUNNING') {
      sendCommand('switch')
    } else if (state === 'GAME_OVER' && canRetry) {
      sendCommand('retry')
    }
  }, options)

  return () => listeners.abort()
}
