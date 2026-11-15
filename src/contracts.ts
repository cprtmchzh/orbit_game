export type Lane = 'inner' | 'outer'
export type GameState = 'READY' | 'COUNTDOWN' | 'RUNNING' | 'PAUSED' | 'GAME_OVER'
export type GameCommand = 'start' | 'switch' | 'pause' | 'resume' | 'retry'

export interface Obstacle {
  readonly lane: Lane
  /** Clockwise, accumulated radians, including all previous revolutions. */
  readonly centerRad: number
}

/** Contact at either edge counts. The score stops at this contact. */
export interface Collision {
  readonly lane: Lane
  readonly angleRad: number
  readonly obstacle: Obstacle
}

export interface GameSnapshot {
  readonly state: GameState
  readonly lane: Lane
  readonly angleRad: number
  /** Active play only, in milliseconds. Keeps sub-millisecond collision precision. */
  readonly survivalMs: number
  readonly countdownRemainingMs: number
  readonly visibleObstacles: readonly Obstacle[]
  readonly collision: Collision | null
  /** True while paused or after the result screen's retry lock expires. */
  readonly canRetry: boolean
}

/** All atMs values share one monotonic browser clock. Out-of-order times never rewind play. */
export interface GameController {
  readonly update: (atMs: number) => void
  /** Advance to the input time before acting. An invalid command for the current state is ignored. */
  readonly dispatch: (command: GameCommand, atMs: number) => void
  readonly getSnapshot: () => GameSnapshot
}

/** The browser integration owns the record and updates it once on entry to GAME_OVER. */
export interface RecordView {
  readonly bestTimeMs: number
  readonly isNewBest: boolean
}

export interface ViewControls {
  readonly canvas: HTMLCanvasElement
  readonly start: HTMLButtonElement
  readonly pause: HTMLButtonElement
  readonly resume: HTMLButtonElement
  readonly retry: HTMLButtonElement
  readonly restart: HTMLButtonElement
}

export interface GameView {
  readonly canvas: HTMLCanvasElement
  readonly controls: ViewControls
  readonly render: (snapshot: GameSnapshot, record: RecordView) => void
  readonly destroy: () => void
}

/** The caller supplies the timestamp when forwarding a command to dispatch. */
export type BindInput = (
  controls: ViewControls,
  getSnapshot: () => GameSnapshot,
  sendCommand: (command: GameCommand) => void,
) => () => void
