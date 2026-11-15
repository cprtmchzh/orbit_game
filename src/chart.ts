import { chartLimits, geometry, noteArrivalSec } from './config'
import type { ChartHead, PlayableChart, SourceChart, SourceNote, SourceTrack } from './contracts'

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('차트 객체 형식을 확인하세요.')
  return value as Record<string, unknown>
}

function list(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} 목록이 필요합니다.`)
  return value
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 문자열이 필요합니다.`)
  return value
}

function finite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} 값은 유한한 수여야 합니다.`)
  return value
}

function audioLength(value: unknown): number {
  const sec = finite(value, '음원 길이')
  if (sec <= 0 || sec > chartLimits.maxAudioSec) throw new Error(`음원 길이는 0초 초과 ${chartLimits.maxAudioSec}초 이하여야 합니다.`)
  return sec
}

function unique(ids: readonly string[], label: string) {
  if (new Set(ids).size !== ids.length) throw new Error(`${label} ID가 중복되었습니다.`)
}

export function parseChart(raw: unknown): SourceChart {
  const data = object(raw)
  if (data.schemaVersion !== 2) throw new Error('차트 형식 버전 2가 필요합니다.')
  const tracks: SourceTrack[] = list(data.tracks, '파트').map(rawTrack => {
    const t = object(rawTrack)
    if (t.kind !== 'pitched' && t.kind !== 'drums') throw new Error('지원하지 않는 파트 종류입니다.')
    return { id: string(t.id, '파트 ID'), name: string(t.name, '파트 이름'), kind: t.kind }
  })
  unique(tracks.map(t => t.id), '파트')
  const trackIds = new Set(tracks.map(t => t.id))
  const noteData = list(data.notes, '음표')
  if (!noteData.length || noteData.length > chartLimits.maxNotes) throw new Error('음표는 1개 이상 20,000개 이하로 등록하세요.')
  const notes: SourceNote[] = noteData.map(rawNote => {
    const n = object(rawNote)
    const trackId = string(n.trackId, '음표 파트')
    if (!trackIds.has(trackId)) throw new Error(`알 수 없는 음표 파트입니다 (${trackId}).`)
    const pitch = finite(n.pitch, '음높이')
    if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) throw new Error('MIDI 음높이는 0~127의 정수여야 합니다.')
    const startSec = finite(n.startSec, '음표 시작 시각')
    const durationSec = finite(n.durationSec, '음표 길이')
    if (startSec < 0 || durationSec < 0) throw new Error('음표 시작 시각과 길이는 0초 이상이어야 합니다.')
    return { id: string(n.id, '음표 ID'), trackId, pitch, startSec, durationSec }
  })
  unique(notes.map(n => n.id), '음표')
  const defaultTrackIds = list(data.defaultTrackIds, '기본 파트').map(id => string(id, '기본 파트'))
  unique(defaultTrackIds, '기본 파트')
  if (!defaultTrackIds.length || defaultTrackIds.some(id => !trackIds.has(id))) throw new Error('기본 파트 ID를 확인하세요.')
  return {
    schemaVersion: 2, songId: string(data.songId, '곡 ID'), title: string(data.title, '곡명'),
    chartVersion: string(data.chartVersion, '차트 버전'), audioDurationSec: audioLength(data.audioDurationSec),
    offsetSec: finite(data.offsetSec, '오프셋'), defaultTrackIds, tracks, notes,
    ...(data.audioHash === undefined ? {} : { audioHash: string(data.audioHash, '음원 해시') }),
  }
}

export function buildChart(
  source: SourceChart, selectedTrackIds: readonly string[] = source.defaultTrackIds, audioEndSec = source.audioDurationSec,
): PlayableChart {
  audioLength(audioEndSec)
  unique(selectedTrackIds, '선택 파트')
  const selected = new Set(selectedTrackIds)
  const known = new Set(source.tracks.map(t => t.id))
  if (!selected.size || selectedTrackIds.some(id => !known.has(id))) throw new Error('재생할 파트를 선택하세요. 알 수 없는 파트는 선택할 수 없습니다.')
  const noteCounts = new Map<string, number>()
  for (const n of source.notes) noteCounts.set(n.trackId, (noteCounts.get(n.trackId) ?? 0) + 1)
  const included = new Set(source.tracks.filter(t => t.kind === 'pitched' && selected.has(t.id)).map(t => t.id))
  const excludedTracks = source.tracks.filter(t => !included.has(t.id)).map(t => ({
    trackId: t.id, noteCount: noteCounts.get(t.id) ?? 0,
    reason: t.kind === 'drums' ? 'drums' as const : 'not-selected' as const,
  }))
  if (!included.size) throw new Error('음높이 파트가 필요합니다. 드럼만으로는 플레이할 수 없습니다.')
  const notes = source.notes.filter(n => included.has(n.trackId))
  const pitches = [...new Set(notes.map(n => n.pitch))].sort((a, b) => b - a)
  if (pitches.length < 2) throw new Error('선택한 파트에 서로 다른 음높이가 2개 이상 있어야 합니다.')
  const spacing = (geometry.laneBottomY - geometry.laneTopY) / (pitches.length - 1)
  if (spacing < 2 * geometry.headRadius) throw new Error('음높이가 많아 음표가 겹칩니다. 더 적은 파트를 선택하세요.')
  const lanes = pitches.map((pitch, index) => ({ index, pitch, y: geometry.laneTopY + index * spacing }))
  const byPitch = new Map(lanes.map(lane => [lane.pitch, lane.index]))
  const grouped = new Map<string, ChartHead & { sourceIds: string[], durationSec: number }>()
  for (const note of notes) {
    const arrivalSec = noteArrivalSec(note.startSec, source.offsetSec)
    if (arrivalSec < 0 || arrivalSec > audioEndSec) throw new Error(`음표 ${note.id}의 보정된 시작이 음원 범위 밖입니다.`)
    const key = `${note.pitch}:${note.startSec}`
    const existing = grouped.get(key)
    if (existing) {
      existing.sourceIds.push(note.id)
      existing.durationSec = Math.max(existing.durationSec, note.durationSec)
    } else {
      grouped.set(key, { sourceIds: [note.id], pitch: note.pitch, laneIndex: byPitch.get(note.pitch)!, arrivalSec, durationSec: note.durationSec })
    }
  }
  const heads = [...grouped.values()].sort((a, b) => a.arrivalSec - b.arrivalSec || a.laneIndex - b.laneIndex)
  return { source, selectedTrackIds: [...included], lanes, heads, audioEndSec, excludedTracks }
}
