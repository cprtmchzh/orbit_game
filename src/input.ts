import type { GameCommand, GameState } from './contracts'

export function keyboardCommand(key: string, state?: GameState): GameCommand | undefined {
  if (key === 'Escape' && (state === 'PLAYING' || state === 'LEAD_IN' || state === 'RESUMING')) return 'pause'
  if (state !== 'PLAYING' && state !== 'LEAD_IN') return
  switch (key.toLowerCase()) {
    case 'arrowup': case 'w': return 'up'
    case 'arrowdown': case 's': return 'down'
  }
}

/** Native button clicks normalize touch, pointer and keyboard activation exactly once. */
export function bindInput(root: HTMLElement, state: () => GameState | undefined, dispatch: (command: GameCommand) => void) {
  const keyboard = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable=true]')) return
    const command = keyboardCommand(event.key, state())
    if (!command) return
    event.preventDefault()
    if (!event.repeat) dispatch(command)
  }
  const click = (event: MouseEvent) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return
    const button = event.target.closest<HTMLButtonElement>('button[data-command]')
    if (!button || !root.contains(button) || button.disabled || button.closest('[hidden]')) return
    dispatch(button.dataset.command as GameCommand)
  }
  window.addEventListener('keydown', keyboard)
  root.addEventListener('click', click)
  return () => {
    window.removeEventListener('keydown', keyboard)
    root.removeEventListener('click', click)
  }
}
