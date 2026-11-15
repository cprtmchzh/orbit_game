export const geometry = {
  logicalSize: 400,
  centerX: 200,
  centerY: 200,
  orbitRadius: { inner: 105, outer: 155 },
  playerRadius: 5,
  obstacleHalfWidthRad: Math.PI / 60,
  obstacleHalfDepth: 9,
} as const

/** One clockwise revolution every five seconds, on either lane. */
export const angularSpeedRadPerMs = (2 * Math.PI) / 5000

export const timing = {
  countdownMs: 1000,
  retryLockMs: 300,
  maxFrameGapMs: 250,
  firstSafeMs: 2000,
  revealLeadMs: 1800,
  minWarningMs: 1500,
  minSwitchGapMs: 350,
} as const

/** Apply the current band only to newly generated patterns. Intervals are center to center. */
export const difficultyBands = [
  { fromMs: 0, minIntervalMs: 1200, maxIntervalMs: 1500 },
  { fromMs: 15_000, minIntervalMs: 950, maxIntervalMs: 1250 },
  { fromMs: 30_000, minIntervalMs: 800, maxIntervalMs: 1050 },
  { fromMs: 60_000, minIntervalMs: 650, maxIntervalMs: 900 },
] as const
