import type { PlayableChart } from './contracts'

export interface BestRecord {
  hits: number
  totalNotes: number
  perfect: boolean
}

export function recordKey(chart: PlayableChart, audioHash: string, chartHash: string): string {
  const id = [chart.source.songId, audioHash, chartHash, chart.source.chartVersion,
    [...chart.selectedTrackIds].sort(), 'note-catch-v1']
  return 'orbit-switch:catch:v1:' + JSON.stringify(id)
}

function validScore(hits: unknown, total: unknown): boolean {
  return typeof hits === 'number' && Number.isSafeInteger(hits) && hits >= 0 &&
    typeof total === 'number' && Number.isSafeInteger(total) && total > 0 && hits <= total
}

function isBetter(score: BestRecord, previous: BestRecord | undefined): boolean {
  return !previous || score.hits / score.totalNotes > previous.hits / previous.totalNotes
}

export function createRecordStore(storage: () => Pick<Storage, 'getItem'|'setItem'> = () => window.localStorage) {
  const memory = new Map<string, BestRecord>()
  function read(key: string): BestRecord | undefined {
    let best = memory.get(key)
    try {
      const raw = storage().getItem(key)
      const saved = raw && JSON.parse(raw)
      if (saved?.version === 1 && validScore(saved.hits, saved.totalNotes) &&
          saved.perfect === (saved.hits === saved.totalNotes) && isBetter(saved, best)) {
        best = { hits: saved.hits, totalNotes: saved.totalNotes, perfect: saved.perfect }
        memory.set(key, best)
      }
    } catch { /* A blocked store or malformed record leaves the session's result available. */ }
    return best
  }
  return {
    read,
    finish(key: string, hits: number, totalNotes: number): BestRecord | undefined {
      const previous = read(key)
      if (!validScore(hits, totalNotes)) return previous
      const result = { hits, totalNotes, perfect: hits === totalNotes }
      if (!isBetter(result, previous)) return previous
      memory.set(key, result)
      try { storage().setItem(key, JSON.stringify({ version: 1, ...result })) } catch { /* Keep in memory. */ }
      return result
    },
  }
}
