import { geometry, timing } from './config'
import type { AudioClockSample, Collision, Direction, GameCommand, GameController, GameSnapshot, GameState, Movement, PlayableChart, VisibleHead } from './contracts'
import { contactHalfSec, firstCollision, firstHeadAt, headCircle, playerCircle, playerY } from './rules'

export function createGame(chart: PlayableChart): GameController {
  const initialLane = Math.floor((chart.lanes.length - 1) / 2)
  const lastHeadEnd = chart.heads[chart.heads.length - 1].arrivalSec + contactHalfSec
  const stageEnd = Math.max(chart.audioEndSec, lastHeadEnd)
  let state: GameState = 'READY'
  let songSec: number = -timing.leadInSec
  let resumeRemainingSec = 0
  let lane = initialLane
  let move: Movement | null = null
  let queued: Direction | null = null
  let collision: Collision | null = null

  function beginMove(direction: Direction) {
    const to = lane + (direction === 'up' ? -1 : 1)
    if (to >= 0 && to < chart.lanes.length) {
      move = { fromLane: lane, toLane: to, startSec: songSec, endSec: songSec + timing.moveSec }
    }
  }

  function advance(to: number) {
    if (to < songSec) return
    const until = Math.min(to, stageEnd)
    do {
      const end = Math.min(move?.endSec ?? until, until)
      collision = firstCollision(chart, lane, move, songSec, end)
      if (collision) {
        songSec = collision.songSec
        state = 'FAILED'
        queued = null
        return
      }
      songSec = end
      if (move && songSec >= move.endSec) {
        lane = move.toLane
        move = null
        if (queued) beginMove(queued)
        queued = null
      }
    } while (songSec < until)
    if (to >= chart.audioEndSec && to > lastHeadEnd) {
      state = 'CLEARED'
      queued = null
    } else {
      state = songSec < 0 ? 'LEAD_IN' : 'PLAYING'
    }
  }

  function valid(clock: AudioClockSample) {
    return Number.isFinite(clock.songSec) && Number.isFinite(clock.resumeRemainingSec) && clock.resumeRemainingSec >= 0
  }

  function update(clock: AudioClockSample) {
    if (!valid(clock)) return
    if (state === 'RESUMING') {
      resumeRemainingSec = Math.min(resumeRemainingSec, clock.resumeRemainingSec)
      if (resumeRemainingSec > 0) return
    } else if (state !== 'LEAD_IN' && state !== 'PLAYING') return
    advance(clock.songSec)
  }

  function dispatch(command: GameCommand, clock: AudioClockSample) {
    if (!valid(clock)) return
    if ((command === 'start' && state === 'READY') ||
        (command === 'retry' && (state === 'FAILED' || state === 'CLEARED' || state === 'PAUSED'))) {
      songSec = -timing.leadInSec
      state = 'LEAD_IN'
      lane = initialLane
      move = null
      queued = null
      collision = null
      resumeRemainingSec = 0
      advance(clock.songSec)
      return
    }
    if (clock.songSec < songSec) return
    if (command === 'resume' && state === 'PAUSED') {
      state = 'RESUMING'
      resumeRemainingSec = timing.resumeHoldSec
      return
    }
    update(clock)
    if (command === 'pause' && (state === 'LEAD_IN' || state === 'PLAYING' || state === 'RESUMING')) {
      state = 'PAUSED'
      resumeRemainingSec = 0
      return
    }
    if ((state !== 'LEAD_IN' && state !== 'PLAYING') || (command !== 'up' && command !== 'down')) return
    if (move) {
      const target = move.toLane + (command === 'up' ? -1 : 1)
      if (target >= 0 && target < chart.lanes.length) queued = command
    } else beginMove(command)
  }

  function getSnapshot(): GameSnapshot {
    const visibleHeads: VisibleHead[] = []
    // Keep a head whose body is still within the left side of the viewport.
    const pastSec = (geometry.playerX + geometry.headRadius) / geometry.scrollUnitsPerSec
    for (let i = firstHeadAt(chart.heads, songSec - pastSec); i < chart.heads.length; i++) {
      const head = chart.heads[i]
      if (head.arrivalSec > songSec + timing.lookaheadSec) break
      visibleHeads.push(headCircle(head, chart.lanes[head.laneIndex].y, songSec))
    }
    return {
      state, songSec, resumeRemainingSec, progress: Math.min(1, Math.max(0, songSec / chart.audioEndSec)),
      player: playerCircle(playerY(chart.lanes, lane, move, songSec)), movement: move, queuedDirection: queued,
      visibleHeads, collision,
    }
  }
  return { update, dispatch, getSnapshot }
}
