/** Local chart JSON. All time fields are seconds. Parsers validate finite values at the boundary. */
export interface SourceChart {
  readonly schemaVersion: 2
  readonly songId: string
  readonly title: string
  readonly chartVersion: string
  readonly audioDurationSec: number
  readonly offsetSec: number
  readonly audioHash?: string
  readonly defaultTrackIds: readonly string[]
  readonly tracks: readonly SourceTrack[]
  readonly notes: readonly SourceNote[]
}

export interface SourceTrack {
  readonly id: string
  readonly name: string
  readonly kind: 'pitched' | 'drums'
}

export interface SourceNote {
  readonly id: string
  readonly trackId: string
  readonly pitch: number
  readonly startSec: number
  readonly durationSec: number
}

/** Index 0 is the highest selected MIDI pitch. The layout is fixed for a round. */
export interface Lane {
  readonly index: number
  readonly pitch: number
  readonly y: number
}

export interface ChartHead {
  /** All contributing original note IDs, including coincident notes merged into one head. */
  readonly sourceIds: readonly string[]
  readonly pitch: number
  readonly laneIndex: number
  /** Source startSec + offsetSec, applied once. Neither audio nor renderer adds the offset again. */
  readonly arrivalSec: number
  /** Decorative tail only. */
  readonly durationSec: number
}

export interface PlayableChart {
  readonly source: SourceChart
  readonly selectedTrackIds: readonly string[]
  readonly lanes: readonly Lane[]
  readonly heads: readonly ChartHead[]
  /** Actual end of the playable audio segment, in the same timeline as arrivalSec. */
  readonly audioEndSec: number
  readonly excludedTracks: readonly {
    readonly trackId: string
    readonly noteCount: number
    readonly reason: 'not-selected' | 'drums'
  }[]
}

/** The integration samples the audio transport once per input/RAF. Never use DOM event milliseconds here. */
export interface AudioClockSample {
  readonly songSec: number
  /** Zero outside the resume hold. Song position stays frozen throughout that hold. */
  readonly resumeRemainingSec: number
}

export type Direction = 'up' | 'down'
export type GameCommand = Direction | 'start' | 'retry' | 'pause' | 'resume'
export type GameState = 'READY' | 'LEAD_IN' | 'PLAYING' | 'PAUSED' | 'RESUMING' | 'FAILED' | 'CLEARED'

export interface Movement {
  readonly fromLane: number
  readonly toLane: number
  readonly startSec: number
  readonly endSec: number
}

/** Logical, uniformly scaled coordinates shared by the renderer and collision solver. */
export interface Circle {
  readonly x: number
  readonly y: number
  readonly radius: number
}

export interface VisibleHead extends Circle {
  readonly note: ChartHead
}

export interface Collision {
  readonly songSec: number
  readonly player: Circle
  readonly noteHead: VisibleHead
}

export interface GameSnapshot extends AudioClockSample {
  readonly state: GameState
  /** Fraction of the playable audio segment, clamped to [0, 1]. Check state for clear. */
  readonly progress: number
  readonly player: Circle
  readonly movement: Movement | null
  /** At most one pending move. The last accepted direction replaces the previous pending direction. */
  readonly queuedDirection: Direction | null
  readonly visibleHeads: readonly VisibleHead[]
  readonly collision: Collision | null
}

/** game.ts exports createGame(chart: PlayableChart): GameController.
 * Start/retry after a successful audio reservation at -2. Lead-in permits movement and contact.
 * Dispatch first advances to the input's songSec. Earliest contact wins over input or clear.
 * Resume uses a frozen one-second hold, then continues from the previous song position.
 * Clear requires both audio end and passage beyond the last head's inclusive contact window.
 */
export interface GameController {
  readonly update: (clock: AudioClockSample) => void
  readonly dispatch: (command: GameCommand, clock: AudioClockSample) => void
  readonly getSnapshot: () => GameSnapshot
}
