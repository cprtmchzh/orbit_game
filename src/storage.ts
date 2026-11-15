import type { PlayableChart } from './contracts'

export interface BestRecord { progress: number; cleared: boolean }

export function recordKey(chart: PlayableChart, audioHash: string, chartHash: string): string {
  const id = [chart.source.songId, audioHash, chartHash, chart.source.chartVersion,
    [...chart.selectedTrackIds].sort(), 'linear-heads-v2.0']
  return 'orbit-switch:v2:' + JSON.stringify(id)
}

export function createRecordStore(storage: () => Pick<Storage, 'getItem'|'setItem'> = () => window.localStorage) {
  const memory = new Map<string, BestRecord>()
  function read(key: string): BestRecord {
    let prior = memory.get(key) ?? { progress: 0, cleared: false }
    try {
      const stored = JSON.parse(storage().getItem(key) ?? 'null')
      if (stored && stored.version === 2 && typeof stored.cleared === 'boolean' &&
          Number.isFinite(stored.progress) && stored.progress >= 0 && stored.progress <= 1) {
        prior = { progress: Math.max(prior.progress, stored.progress), cleared: prior.cleared || stored.cleared }
      }
    } catch { /* Keep the in-session record if storage is unavailable or corrupt. */ }
    memory.set(key, prior)
    return prior
  }
  return {
    read,
    finish(key: string, progress: number, cleared: boolean): BestRecord {
      const prior = read(key)
      if (!Number.isFinite(progress) || progress < 0 || progress > 1) return prior
      const best = { progress: Math.max(prior.progress, progress), cleared: prior.cleared || cleared }
      if (best.progress !== prior.progress || best.cleared !== prior.cleared) {
        memory.set(key, best)
        try { storage().setItem(key, JSON.stringify({ version: 2, ...best })) } catch { /* Session fallback. */ }
      }
      return best
    },
  }
}
