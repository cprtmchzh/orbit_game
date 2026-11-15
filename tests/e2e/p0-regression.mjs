import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const [dist, expectedHash] = process.argv.slice(2)
assert.ok(dist && /^[a-f0-9]{64}$/.test(expectedHash ?? ''), 'Pass the candidate dist path and expected SHA-256 manifest.')
const { chromium } = createRequire(import.meta.url)(process.env.ORBIT_PLAYWRIGHT_MODULE || 'playwright')
const origin = 'https://orbit-switch.test'
const key = 'orbit-switch:v1'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const files = new Map()

async function readAssets(relative = '') {
  const items = await readdir(path.join(dist, relative), { withFileTypes: true })
  for (const item of items) {
    const name = path.posix.join(relative, item.name)
    if (item.isDirectory()) await readAssets(name)
    else if (item.isFile()) files.set(name, await readFile(path.join(dist, name)))
  }
}
await readAssets()
assert.ok(files.has('index.html'))
// Match the project manifest's case-sensitive, linguistic path ordering (PowerShell Sort-Object).
const order = new Intl.Collator('en', { sensitivity: 'variant' })
const manifest = [...files.keys()].sort(order.compare).map(name => hash(files.get(name)) + '  ' + name + '\n').join('')
assert.equal(hash(manifest), expectedHash)

// Runs in the disposable page before its modules. All gameplay still uses native inputs and RAF.
function installCounters({ storageMode, key }) {
  const counters = window.orbitProbe = {
    pending: 0, peak: 0, frames: 0, sameFrame: 0, lastFrame: null,
    listeners: {}, reads: 0, writes: 0, visibility: [],
  }
  const realRaf = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = callback => {
    counters.peak = Math.max(counters.peak, ++counters.pending)
    return realRaf(timestamp => {
      counters.pending--
      counters.frames++
      if (timestamp === counters.lastFrame) counters.sameFrame++
      counters.lastFrame = timestamp
      callback(timestamp)
    })
  }
  document.addEventListener('visibilitychange', () => counters.visibility.push(document.visibilityState))
  const listen = EventTarget.prototype.addEventListener
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (new Error().stack.includes('/assets/')) {
      const target = this === document ? 'document' : this.dataset?.action || this.nodeName
      const name = target + '/' + type
      counters.listeners[name] = (counters.listeners[name] || 0) + 1
    }
    return listen.call(this, type, listener, options)
  }
  if (storageMode === 'corrupt') localStorage.setItem(key, '{invalid')
  if (storageMode === 'denied') {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Denied', 'SecurityError') } })
    return
  }
  const get = Storage.prototype.getItem
  const set = Storage.prototype.setItem
  Storage.prototype.getItem = function (name) {
    if (name === key) counters.reads++
    return get.call(this, name)
  }
  Storage.prototype.setItem = function (name, value) {
    if (name === key) {
      counters.writes++
      if (storageMode === 'writeDenied') throw new DOMException('Full', 'QuotaExceededError')
    }
    return set.call(this, name, value)
  }
}

const browser = await chromium.launch({ headless: true, channel: process.env.ORBIT_BROWSER_CHANNEL || undefined })
const result = { manifestSha256: expectedHash, browser: browser.version(), viewport: '360x800', retries: 0 }
async function fixture(storageMode = 'normal') {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, serviceWorkers: 'block' })
  const log = { offline: false, loaded: [], unexpected: [], errors: [] }
  await context.addInitScript(installCounters, { storageMode, key })
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    const name = url.pathname.slice(1) || 'index.html'
    if (url.origin !== origin || !files.has(name) || log.offline) {
      log.unexpected.push(url.href)
      return route.abort()
    }
    const type = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html' }[path.extname(name)]
    log.loaded.push(name)
    await route.fulfill({ contentType: type, body: files.get(name) })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(7000)
  page.on('console', message => { if (message.type() === 'error') log.errors.push(message.text()) })
  page.on('pageerror', error => log.errors.push(error.message))
  await page.goto(origin, { waitUntil: 'networkidle' })
  const state = value => page.locator('[data-state="' + value + '"]').waitFor()
  const action = name => page.locator('[data-action="' + name + '"]')
  await state('READY')
  return { page, context, state, action, log }
}

async function playerRadius(page) {
  return page.locator('canvas').evaluate(canvas => {
    const w = canvas.width, h = canvas.height
    const data = canvas.getContext('2d').getImageData(0, 0, w, h).data
    let x = 0, y = 0, pixels = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 198 || data[i+1] !== 255 || data[i+2] !== 130 || data[i+3] !== 255) continue
      const point = i / 4
      x += point % w + 0.5
      y += Math.floor(point / w) + 0.5
      pixels++
    }
    if (!pixels) throw Error('Player pixels missing')
    return +(Math.hypot(x/pixels - w/2, y/pixels - h/2) * 400 / w).toFixed(2)
  })
}

async function repeatedRuns() {
  const { page, context, state, action, log } = await fixture()
  try {
    const probe = () => page.evaluate(() => structuredClone(window.orbitProbe))
    const initial = await probe()
    assert.deepEqual(Object.values(initial.listeners).sort(), Array(8).fill(1))
    assert.equal(initial.reads, 1)
    result.mounted = [...log.loaded]
    result.layoutFits = await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('canvas,button:not([hidden])'), e => e.getBoundingClientRect())
      return document.documentElement.scrollWidth === 360 && boxes.every(b => b.left >= 0 && b.right <= 360 && b.bottom <= 800)
    })
    assert.equal(result.layoutFits, true)
    log.offline = true
    await context.setOffline(true)
    await page.keyboard.press('Space')
    await state('RUNNING')
    const inside = await playerRadius(page)
    await page.locator('canvas').click()
    const outside = await playerRadius(page)
    await page.keyboard.press('Space')
    const back = await playerRadius(page)
    result.measuredRadii = [inside, outside, back]
    for (const [actual, target] of [[inside,105], [outside,155], [back,105]]) assert.ok(Math.abs(actual-target)<2)
    for (let round = 0; round <= 20; round++) {
      await state('GAME_OVER')
      assert.equal(await page.locator('[data-clock]').innerText(), '2.0초')
      const current = await probe()
      assert.equal(current.reads, round + 2, 'initial read + one result check per round')
      assert.equal(current.writes, 1, 'only the first record exceeds the prior best')
      assert.equal(current.peak, 1, 'one outstanding app RAF')
      assert.equal(current.sameFrame, 0, 'one callback per display frame')
      assert.deepEqual(current.listeners, initial.listeners)
      if (round === 20) break
      await action('retry').click()
      await state('COUNTDOWN')
      await state('RUNNING')
      result.retries++
      if (result.retries % 5 === 0) console.log('Retries reaching RUNNING:', result.retries)
    }
    const final = await probe()
    result.loop = { results: 21, maxPending: final.peak, sameFrame: final.sameFrame, frames: final.frames,
      listeners: final.listeners, reads: final.reads, writes: final.writes }
    assert.deepEqual(log.unexpected, [])
    assert.deepEqual(log.errors, [])
    result.afterLoadRequests = log.unexpected
    result.consoleErrors = log.errors
    log.offline = false
    await context.setOffline(false)
    await page.reload({ waitUntil: 'networkidle' })
    await state('READY')
    result.restoredBest = await page.locator('[data-best]').innerText()
    assert.equal(result.restoredBest, '2.0초')
    assert.deepEqual(log.errors, [])
  } finally { await context.close() }
}

async function visibilityCheck() {
  const { page, context, state, log, action } = await fixture()
  try {
    // Only switch tabs in our disposable browser. A headless browser may report both visible.
    const otherTab = await context.newPage()
    await page.bringToFront()
    await page.keyboard.press('Space')
    await state('RUNNING')
    await otherTab.bringToFront()
    await new Promise(resolve => setTimeout(resolve, 100))
    await page.bringToFront()
    await otherTab.close()
    const events = await page.evaluate(() => [...window.orbitProbe.visibility])
    result.browserVisibilityEvents = events
    if (events.includes('hidden') && events.at(-1) === 'visible') {
      result.visibilityMethod = 'isolated tab switch; native hidden then visible'
    } else {
      // Start with a live game and advance on a fresh frame. Freeze cannot mask the assertion.
      const transition = await page.evaluate(() => new Promise(resolve => {
        requestAnimationFrame(() => {
          const panel = document.querySelector('[data-state]')
          const before = panel.dataset.state
          Object.defineProperty(document, 'hidden', { configurable: true, value: true })
          document.dispatchEvent(new Event('visibilitychange'))
          const hidden = panel.dataset.state
          delete document.hidden
          document.dispatchEvent(new Event('visibilitychange'))
          resolve([before, hidden, panel.dataset.state])
        })
      }))
      assert.deepEqual(transition, ['RUNNING', 'PAUSED', 'PAUSED'])
      result.syntheticVisibilityTransition = transition
      result.visibilityMethod = 'simulated visibilitychange; native tab hiding unverified'
    }
    await state('PAUSED')
    const time = await page.locator('[data-clock]').innerText()
    await page.waitForTimeout(350)
    assert.equal(await page.locator('[data-clock]').innerText(), time)
    await action('resume').click()
    await state('COUNTDOWN')
    await state('RUNNING')
    result.pauseTime = time
    // Independently miss a frame deadline on a visible page, without a visibility event.
    await page.evaluate(() => {
      const end = performance.now() + 310
      while (performance.now() < end) { /* Deliberately block this disposable page. */ }
    })
    await state('PAUSED')
    result.longFramePaused = true
    assert.deepEqual(log.errors, [])
    assert.deepEqual(log.unexpected, [])
  } finally { await context.close() }
}

async function storageCheck(mode) {
  const { page, context, state, log, action } = await fixture(mode)
  try {
    assert.equal(await page.locator('[data-best]').innerText(), '0.0초')
    await page.keyboard.press('Space')
    await state('GAME_OVER')
    assert.equal(await page.locator('[data-best]').innerText(), '2.0초')
    await action('retry').click()
    await state('RUNNING')
    assert.equal(await page.locator('[data-best]').innerText(), '2.0초')
    assert.deepEqual(log.unexpected, [])
    assert.deepEqual(log.errors, [])
    return { recoveredBest: '2.0초', retried: true }
  } finally { await context.close() }
}

try {
  await repeatedRuns()
  await visibilityCheck()
  result.storage = {}
  for (const mode of ['corrupt','denied','writeDenied']) result.storage[mode] = await storageCheck(mode)
  console.log(JSON.stringify(result, null, 2))
} finally { await browser.close() }
