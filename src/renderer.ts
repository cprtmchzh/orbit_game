import type { Circle, GameSnapshot, Lane, PlayableChart } from './contracts'
import { geometry } from './config'

const notes = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

export function pitchLabel(pitch: number): string {
  return notes[pitch % 12] + (Math.floor(pitch / 12) - 1)
}

export function readableLanes(lanes: readonly Lane[], cssWidth: number): boolean {
  const scale = cssWidth / geometry.width
  return lanes.length >= 2 && geometry.headRadius * 2 * scale >= 4 &&
    lanes.slice(1).every((lane, i) => (lane.y - lanes[i].y) * scale >= 16)
}

export function createRenderer(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('이 브라우저에서 게임 화면을 그릴 수 없습니다.')

  return function draw(chart: PlayableChart, frame: GameSnapshot) {
    const box = canvas.getBoundingClientRect()
    if (!box.width || !box.height) return
    const dpr = window.devicePixelRatio || 1
    const width = Math.max(1, Math.round(box.width * dpr))
    const height = Math.max(1, Math.round(box.height * dpr))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    const scale = Math.min(width / geometry.width, height / geometry.height)
    ctx.setTransform(scale, 0, 0, scale, (width - geometry.width * scale) / 2, (height - geometry.height * scale) / 2)
    ctx.fillStyle = '#161b1b'
    ctx.fillRect(0, 0, geometry.width, geometry.height)
    const labelSize = Math.min(30, Math.max(15, 12 * dpr / scale))
    ctx.font = '600 ' + labelSize + 'px ui-monospace, monospace'
    ctx.textBaseline = 'middle'
    for (const lane of chart.lanes) {
      ctx.strokeStyle = '#465050'
      ctx.lineWidth = 1.25
      ctx.beginPath()
      ctx.moveTo(76, lane.y)
      ctx.lineTo(geometry.width, lane.y)
      ctx.stroke()
      ctx.fillStyle = '#d3dcd9'
      ctx.fillText(pitchLabel(lane.pitch), 8, lane.y, 64)
    }
    ctx.strokeStyle = '#626e69'
    ctx.setLineDash([4, 8])
    ctx.beginPath()
    ctx.moveTo(geometry.playerX, 18)
    ctx.lineTo(geometry.playerX, geometry.height - 18)
    ctx.stroke()
    ctx.setLineDash([])

    function disk(circle: Circle, color: string) {
      ctx!.beginPath()
      ctx!.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2)
      ctx!.fillStyle = color
      ctx!.fill()
    }

    // Thin tails and stems are decoration. Only the filled head matches the contact circle.
    for (const head of frame.visibleHeads) {
      const end = Math.min(geometry.width, head.x + head.note.durationSec * geometry.scrollUnitsPerSec)
      const stemX = head.x + head.radius - 1
      ctx.lineWidth = 1.5
      ctx.strokeStyle = '#788080'
      ctx.beginPath()
      ctx.moveTo(head.x, head.y)
      ctx.lineTo(end, head.y)
      ctx.moveTo(stemX, head.y)
      ctx.lineTo(stemX, head.y - 3 * head.radius)
      ctx.lineTo(stemX + head.radius, head.y - 2.4 * head.radius)
      ctx.stroke()
      disk(head, '#f5f4e9')
    }
    disk(frame.player, '#8ce4ce')
    disk({ ...frame.player, radius: frame.player.radius * 0.36 }, '#192522')
    if (frame.collision) {
      const hit = frame.collision.noteHead
      ctx.beginPath()
      ctx.arc(hit.x, hit.y, hit.radius + 5, 0, Math.PI * 2)
      ctx.strokeStyle = '#ffb89e'
      ctx.lineWidth = 3
      ctx.stroke()
    }
  }
}
