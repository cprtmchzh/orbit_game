import type { RecordView } from './contracts'

const storageKey = 'orbit-switch:v1'
type RecordStorage = Pick<Storage, 'getItem' | 'setItem'>

function readBestTime(storage: RecordStorage | undefined): number {
  try {
    const raw = storage?.getItem(storageKey)
    if (!raw) return 0

    const record: unknown = JSON.parse(raw)
    if (typeof record !== 'object' || record === null ||
        !('version' in record) || record.version !== 1 || !('bestTimeMs' in record)) {
      return 0
    }

    const value = record.bestTimeMs
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
  } catch {
    return 0
  }
}

/** Create once per page. Call finishRun once on entry to GAME_OVER. */
export function createRecordStore(getStorage: () => RecordStorage = () => window.localStorage) {
  let storage: RecordStorage | undefined
  try {
    storage = getStorage()
  } catch {
    // A restricted browser may throw while accessing the localStorage property.
  }
  let bestTimeMs = readBestTime(storage)

  return {
    getBestTimeMs: () => bestTimeMs,
    finishRun(survivalMs: number): RecordView {
      // Another tab may have improved the record since this page was opened.
      bestTimeMs = Math.max(bestTimeMs, readBestTime(storage))
      const resultMs = Math.floor(survivalMs)
      if (!Number.isSafeInteger(resultMs) || resultMs <= bestTimeMs) {
        return { bestTimeMs, isNewBest: false }
      }

      bestTimeMs = resultMs
      try {
        storage?.setItem(storageKey, JSON.stringify({ version: 1, bestTimeMs }))
      } catch {
        // The in-memory record still applies to subsequent runs in this tab.
      }
      return { bestTimeMs, isNewBest: true }
    },
  }
}
