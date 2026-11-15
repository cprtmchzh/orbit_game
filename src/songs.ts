import { parseChart } from './chart'
import { chartLimits } from './config'
import type { SourceChart } from './contracts'

export interface Song {
  id: string
  title: string
  local: boolean
  source: SourceChart
  encoded: Blob
  audioHash: string
  chartHash: string
  selectedTracks: readonly string[]
}

const maxChartBytes = 8 * 1024 * 1024
const maxDecodedBytes = 128 * 1024 * 1024
async function digest(bytes: ArrayBuffer) {
  const value = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(value), n => n.toString(16).padStart(2,'0')).join('')
}

export async function decodeSong(context: BaseAudioContext, encoded: Blob, source: SourceChart): Promise<AudioBuffer> {
  let buffer: AudioBuffer
  try { buffer = await context.decodeAudioData(await encoded.arrayBuffer()) }
  catch { throw new Error('음원을 읽을 수 없습니다. 브라우저가 지원하는 오디오 파일을 선택하세요.') }
  if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > chartLimits.maxAudioSec ||
      buffer.length * buffer.numberOfChannels * 4 > maxDecodedBytes) {
    throw new Error('음원이 3분 또는 디코딩 메모리 한도를 초과합니다.')
  }
  if (Math.abs(buffer.duration - source.audioDurationSec) > 0.1) {
    throw new Error('음원의 실제 길이와 차트의 길이가 일치하지 않습니다.')
  }
  return buffer
}

export async function prepareSong(context: BaseAudioContext, audio: Blob, json: Blob, local: boolean) {
  if (!audio.size || audio.size > chartLimits.maxAudioBytes) throw new Error('음원은 0바이트보다 크고 20 MiB 이하여야 합니다.')
  if (!json.size || json.size > maxChartBytes) throw new Error('차트는 0바이트보다 크고 8 MiB 이하여야 합니다.')
  const chartBytes = await json.arrayBuffer()
  let data: unknown
  try { data = JSON.parse(new TextDecoder().decode(chartBytes)) }
  catch { throw new Error('올바른 차트 JSON 파일을 선택하세요.') }
  const source = parseChart(data)
  const [audioHash, chartHash] = await Promise.all([audio.arrayBuffer().then(digest), digest(chartBytes)])
  if (source.audioHash && source.audioHash.toLowerCase() !== audioHash) throw new Error('차트가 지정한 음원 해시와 파일이 다릅니다.')
  const buffer = await decodeSong(context, audio, source)
  const song: Song = {
    id: (local ? 'local:' : 'default:') + audioHash + ':' + chartHash,
    title: source.title, local, source, encoded: audio, audioHash, chartHash,
    selectedTracks: source.defaultTrackIds,
  }
  return { song, buffer }
}

export async function loadDefault(context: BaseAudioContext) {
  const base = import.meta.env.BASE_URL + 'songs/glass-steps.'
  const [audio, json] = await Promise.all([fetch(base+'wav'), fetch(base+'json')])
  if (!audio.ok || !json.ok) throw new Error('기본곡 파일을 불러올 수 없습니다.')
  return prepareSong(context, await audio.blob(), await json.blob(), false)
}
