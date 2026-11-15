import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)(process.env.ORBIT_PLAYWRIGHT_MODULE || 'playwright')
const dist = path.resolve(process.argv[2] || 'dist')
const origin = 'https://orbit-audio.test'
const browser = await chromium.launch({ headless:true, channel:process.env.ORBIT_BROWSER_CHANNEL || undefined })
const context = await browser.newContext({viewport:{width:1100,height:800},serviceWorkers:'block'})
const page = await context.newPage()
page.setDefaultTimeout(9000)
const errors=[], unexpected=[], loaded=[]
let offline=false
await context.route('**/*',async route=>{
  const u=new URL(route.request().url())
  if (u.origin!==origin || offline) {unexpected.push(u.href);return route.abort()}
  const name=u.pathname.slice(1)||'index.html'
  if (!/^(index\.html|assets\/[\w.-]+\.(?:js|css)|songs\/glass-steps\.(?:wav|json))$/.test(name)) {
    unexpected.push(name);return route.abort()
  }
  const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wav':'audio/wav','.json':'application/json'}[path.extname(name)]
  loaded.push(name)
  return route.fulfill({contentType:type,body:await readFile(path.join(dist,name))})
})
await context.addInitScript(()=>{
  const live=new Set()
  const originalStart=AudioBufferSourceNode.prototype.start
  const originalStop=AudioBufferSourceNode.prototype.stop
  const stats=window.audioProbe={started:0,stopped:0,ended:0,peak:0,current:null}
  AudioBufferSourceNode.prototype.start=function(...args) {
    if (stats.rejectNext) { stats.rejectNext=false; throw new DOMException('Test rejection','NotAllowedError') }
    originalStart.apply(this,args)
    live.add(this)
    stats.current={node:this,at:args[0],offset:args[1]}
    stats.started++; stats.peak=Math.max(stats.peak,live.size)
    this.addEventListener('ended',()=>{live.delete(this);stats.ended++},{once:true})
  }
  AudioBufferSourceNode.prototype.stop=function(...args) {
    originalStop.apply(this,args);live.delete(this);stats.stopped++
  }
})
page.on('pageerror',error=>errors.push(error.message))
page.on('console',msg=>{if(msg.type()==='error') errors.push(msg.text())})
const button=name=>page.locator('[data-command="'+name+'"]')
const status=text=>page.locator('[data-status]').filter({hasText:text}).waitFor()
const decisions = [
  [0.12, 'up'], [0.53, 'up'], [0.78, 'down'], [1.1, 'down'], [1.3, 'down'],
  [2.1, 'up'], [2.53, 'down'], [2.7, 'down'], [3.1, 'up'], [3.6, 'up'],
  [4.1, 'up'], [4.78, 'up'], [5.1, 'down'], [5.53, 'down'], [5.7, 'down'],
  [6.03, 'down'], [6.28, 'up'], [6.6, 'up'], [7.1, 'up'], [7.3, 'up'],
  [8.1, 'down'], [8.6, 'down'], [9.03, 'down'], [9.28, 'down'], [9.6, 'up'],
  [10.03, 'up'], [10.2, 'up'], [10.6, 'down'],
]
async function finishRound(hits) {
  await page.locator('[data-status]').filter({hasText:'연주 결과'}).waitFor({timeout:20000})
  assert.equal(await page.locator('[data-score]').innerText(),hits+'점')
  assert.match(await page.locator('[data-counts]').innerText(),new RegExp('맞힌 음표 '+hits+' / 24\\s+놓친 음표 '+(24-hits)))
  const summary=await page.locator('[data-result]').innerText()
  assert.ok(summary.includes('명중률 '+Math.floor(hits/24*100)+'%'))
  return summary
}

async function retryRound() {
  await button('retry').click()
  await status('준비 주행')
  assert.equal(await page.locator('[data-score]').innerText(),'0점')
}

async function clearViaReplay(){
  const observed=[]
  for(const [target,direction] of decisions){
    await page.waitForFunction(t=>{
      const s=window.audioProbe.current
      return s && s.node.context.currentTime-s.at>=t
    },target,{polling:5,timeout:6000})
    await page.keyboard.press(direction==='up'?'ArrowUp':'ArrowDown')
    observed.push(await page.evaluate(()=>{const s=window.audioProbe.current;return +(s.node.context.currentTime-s.at).toFixed(3)}))
  }
  await finishRound(24)
  return observed
}
const result={browser:browser.version(),defaultSong:{},localSong:{}}
try {
  await page.goto(origin,{waitUntil:'networkidle'})
  await page.locator('[data-title]').filter({hasText:'유리 계단'}).waitFor()
  await page.evaluate(()=>{window.audioProbe.rejectNext=true})
  await button('start').click()
  await page.getByRole('alert').filter({hasText:'음악을 시작할 수 없습니다'}).waitFor()
  assert.ok(await page.locator('[data-stage]').isHidden())
  result.rejectedPlaybackStayedInLibrary=true
  await button('start').click()
  await status('준비 주행')
  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,value:true})
    document.dispatchEvent(new Event('visibilitychange'))
    delete document.hidden
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await status('일시정지')
  await page.waitForTimeout(300)
  assert.equal(await page.locator('[data-status]').innerText(),'일시정지')
  result.simulatedVisibilityPause=true
  await button('resume').click()
  await status('재개 준비')
  await status('준비 주행')
  await page.evaluate(()=>{
    const until=performance.now()+310
    while(performance.now()<until){ /* visible frame stall */ }
  })
  await status('일시정지')
  result.longFramePause=true
  await button('resume').click()
  await status('재개 준비')
  result.defaultSong.partial=await finishRound(6)
  offline=true;await context.setOffline(true)
  for(let i=0;i<20;i++){
    await retryRound()
    await button('pause').click()
    await status('일시정지')
  }
  result.defaultSong.offlineRetriesFromPause=20
  await retryRound()
  result.defaultSong.perfectInputs=await clearViaReplay()
  await page.locator('[data-back]').click()
  await page.locator('[data-add]').click()
  const chart=JSON.parse(await readFile(path.join(dist,'songs/glass-steps.json'),'utf8'))
  chart.songId='local-glass';chart.title='세션 테스트곡'
  const upload=async text=>{
    await page.locator('[data-chart]').setInputFiles({name:'local.json',mimeType:'application/json',buffer:Buffer.from(text)})
    await page.locator('[type=submit]').click()
  }
  await page.locator('[data-audio]').setInputFiles(path.join(dist,'songs/glass-steps.wav'))
  await upload('{broken')
  await page.getByRole('alert').filter({hasText:'JSON'}).waitFor()
  result.localSong.invalidJsonRejected=true
  await upload(JSON.stringify(chart))
  await page.locator('[data-register]').click()
  await page.locator('[data-title]').filter({hasText:chart.title}).waitFor()
  await button('start').click()
  result.localSong.partial=await finishRound(6)
  await retryRound()
  result.localSong.perfectInputs=await clearViaReplay()
  const records=await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('orbit-switch:catch:v1:'))
    .map(key=>JSON.parse(localStorage.getItem(key))))
  assert.equal(records.length,2)
  assert.ok(records.every(r=>r.version===1 && r.hits===24 && r.totalNotes===24 && r.perfect))
  result.records=records
  result.audio=await page.evaluate(()=>{const {started,stopped,ended,peak}=window.audioProbe;return {started,stopped,ended,peak}})
  assert.equal(result.audio.peak,1)
  result.loaded=loaded;result.unexpectedRequests=unexpected;result.errors=errors
  assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[])
  console.log(JSON.stringify(result,null,2))
} finally {await browser.close()}
