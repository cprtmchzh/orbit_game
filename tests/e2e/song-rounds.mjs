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
const decisions=[[-1.5,'up'],[-1.2,'up'],[.54,'down'],[.82,'up'],[4.82,'down'],[5.12,'up'],[7.6,'down'],[8.18,'up']]
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
  await status('클리어')
  assert.match(await page.locator('[data-result]').innerText(),/100%/)
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
  await status('음표에 닿았습니다')
  result.defaultSong.failure=await page.locator('[data-result]').innerText()
  offline=true;await context.setOffline(true)
  // The newly scheduled source starts at song time 0 after the two-second run-up.
  await button('retry').click()
  await status('준비 주행')
  result.defaultSong.clearInputs=await clearViaReplay()
  for(let i=0;i<20;i++){
    await button('retry').click()
    await status('준비 주행')
    await status('음표에 닿았습니다')
    if((i+1)%5===0)console.log('Default retries ending in failure:',i+1)
  }
  result.defaultSong.offlineRepeatedFailures=20
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
  await status('음표에 닿았습니다')
  result.localSong.failure=await page.locator('[data-result]').innerText()
  await button('retry').click()
  await status('준비 주행')
  result.localSong.clearInputs=await clearViaReplay()
  const records=await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('orbit-switch:v2:'))
    .map(key=>JSON.parse(localStorage.getItem(key))))
  assert.equal(records.length,2)
  assert.ok(records.every(r=>r.cleared && r.progress===1))
  result.records=records
  result.audio=await page.evaluate(()=>{const {started,stopped,ended,peak}=window.audioProbe;return {started,stopped,ended,peak}})
  assert.equal(result.audio.peak,1)
  result.loaded=loaded;result.unexpectedRequests=unexpected;result.errors=errors
  assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[])
  console.log(JSON.stringify(result,null,2))
} finally {await browser.close()}
