import { geometry } from './config'
import type { GameSnapshot } from './contracts'

const turn = 2 * Math.PI

export function renderScene(canvas: HTMLCanvasElement, snapshot: GameSnapshot): void {
  const context = canvas.getContext('2d')
  if (!context) return

  const rect = canvas.getBoundingClientRect()
  const pixels = Math.round(Math.min(rect.width, rect.height) * (window.devicePixelRatio || 1))
  if (pixels < 1) return
  if (canvas.width !== pixels || canvas.height !== pixels) {
    canvas.width = pixels
    canvas.height = pixels
  }
  const scale = pixels / geometry.logicalSize
  context.setTransform(scale, 0, 0, scale, 0, 0)
  context.clearRect(0, 0, geometry.logicalSize, geometry.logicalSize)
  const { centerX, centerY, orbitRadius, obstacleHalfDepth, obstacleHalfWidthRad } = geometry

  context.lineWidth = 1.25
  context.strokeStyle = '#526365'
  for (const radius of Object.values(orbitRadius)) {
    context.beginPath()
    context.arc(centerX, centerY, radius, 0, turn)
    context.stroke()
  }

  context.fillStyle = '#ff9270'
  for (const obstacle of snapshot.visibleObstacles) {
    const radius = orbitRadius[obstacle.lane]
    const angle = obstacle.centerRad % turn
    const from = angle - obstacleHalfWidthRad
    const to = angle + obstacleHalfWidthRad
    context.beginPath()
    context.arc(centerX, centerY, radius + obstacleHalfDepth, from, to)
    context.arc(centerX, centerY, radius - obstacleHalfDepth, to, from, true)
    context.closePath()
    context.fill()
  }

  const angle = snapshot.angleRad % turn
  const radius = orbitRadius[snapshot.lane]
  context.fillStyle = '#c6ff82'
  context.beginPath()
  context.arc(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius,
    geometry.playerRadius, 0, turn)
  context.fill()
}
