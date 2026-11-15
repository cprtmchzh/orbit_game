/** Initial design values in logical units. Rendering scales both axes uniformly. */
const width = 960
const playerX = width * 0.23
const headRadius = 8
const lookaheadSec = 2

export const geometry = {
  width,
  height: 480,
  laneTopY: 48,
  laneBottomY: 432,
  playerX,
  playerRadius: 10,
  headRadius,
  // At the preview boundary the entire note head fits at the right edge.
  scrollUnitsPerSec: (width - headRadius - playerX) / lookaheadSec,
} as const

export const timing = {
  leadInSec: 2,
  lookaheadSec,
  moveSec: 0.160,
  resumeHoldSec: 1,
} as const

export const chartLimits = {
  maxAudioSec: 180,
  maxAudioBytes: 20 * 1024 * 1024,
  maxNotes: 20_000,
} as const

/** Convert a source note's chart time to its audio timeline arrival. Never shift the playhead. */
export function noteArrivalSec(startSec: number, offsetSec: number): number {
  return startSec + offsetSec
}

/** Both drawing and collision use the same logical horizontal center. */
export function noteHeadX(arrivalSec: number, songSec: number): number {
  return geometry.playerX + geometry.scrollUnitsPerSec * (arrivalSec - songSec)
}
