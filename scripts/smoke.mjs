// Browser smoke test (L7): loads the demo in headless Chrome, follows the
// demo -> trail link, records a real pointer click, and verifies both page
// views share one session and the click appears in the journey and the
// heatmap. It also checks the malformed-session recovery (M5), the
// double-inclusion guard (M7) and the dashboard auto-refresh (M1/L2).
//
// Run: node scripts/smoke.mjs
// Needs MongoDB running. Uses its own throwaway database and an OS-assigned
// port, both cleaned up afterwards. Direct navigation to localhost is blocked
// on this VM (ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS), so every leg
// starts from a file:// redirect page and in-app movement uses real link
// clicks, which the check exempts.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { MongoClient } from 'mongodb'
import { setTimeout as delay } from 'node:timers/promises'
import { openSync, rmSync, writeFileSync } from 'node:fs'

const CHROME = '/opt/meta-chromium/chrome'
const CDP_PORT = 9333
const PROFILE = '/tmp/trailhead-smoke-chrome'
const REDIRECT = '/tmp/trailhead-smoke-redirect.html'
const dbName = 'trailhead_smoke_' + randomBytes(4).toString('hex')
const mongoUri = 'mongodb://127.0.0.1:27017/' + dbName
const sleep = ms => new Promise(r => setTimeout(r, ms))

const server = spawn(process.execPath, ['server.js'], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, PORT: '0', MONGODB_URI: mongoUri }
})
let stdout = ''
server.stdout.on('data', chunk => { stdout += chunk })
async function listeningPort() {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw Error('Server exited during startup')
    const match = stdout.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)
    if (match) return Number(match[1])
    await delay(100)
  }
  throw Error('Server did not report a listening port')
}

let chrome = null
let client = null
async function main() {
  const port = await listeningPort()
  const base = 'http://127.0.0.1:' + port
  console.log('server on ' + base + ', database ' + dbName)
  writeFileSync(REDIRECT, '<!doctype html><meta charset="utf-8"><title>redirect</title><meta http-equiv="refresh" content="0; url=' + base + '/demo.html">')
  rmSync(PROFILE, { recursive: true, force: true })
  // This VM's Chromium refuses to start without the Hatch WebGL policy
  // flags (see the render audit's launch options for the same pair).
  const WEBGL_POLICY = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt'
  const WEBGL_SHA256 = '8097045f0459c96c4cdc76e3a1af4e0f43f640b4b59c43d6db35e3641c0264c6'
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--hatch-webgl-allowed-domains-file=' + WEBGL_POLICY, '--hatch-webgl-allowed-domains-sha256=' + WEBGL_SHA256,
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + PROFILE, '--window-size=1280,900', 'about:blank'],
    { stdio: ['ignore', 'ignore', openSync('/tmp/trailhead-smoke-chrome.log', 'w')] })
  const deadline = Date.now() + 30000
  while (true) {
    const res = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version').catch(() => null)
    if (res?.ok) break
    if (Date.now() >= deadline) throw Error('Chrome did not start DevTools')
    await delay(250)
  }
  const targets = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')).json()
  const page = targets.find(t => t.type === 'page')
  if (!page) throw Error('no page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  ws.onmessage = e => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  }
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id
    pending.set(mid, m => m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result))
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  const evalJs = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true })
    if (r.exceptionDetails) throw new Error('page JS error: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails))
    return r.result.value
  }
  const waitTitle = async (want, timeoutMs = 15000) => {
    const stop = Date.now() + timeoutMs
    while (Date.now() < stop) {
      if (await evalJs('document.title') === want) return
      await sleep(500)
    }
    throw new Error('timed out waiting for title ' + JSON.stringify(want))
  }
  const api = async path => {
    const res = await fetch(base + path)
    assert.equal(res.status, 200, path)
    return res.json()
  }
  await send('Page.enable')
  await send('Runtime.enable')

  // 1. Load the demo through the file:// redirect.
  await send('Page.navigate', { url: 'file://' + REDIRECT })
  await waitTitle('Field Notes · Demo')
  console.log('demo loaded')
  // 2. Malformed stored session (M5): corrupt the session, reload, and check
  // a fresh valid session is generated and its page view is recorded.
  await evalJs(`localStorage.setItem('trailhead.session', JSON.stringify({id: 123, last: 'soon'})); 'seeded'`)
  await send('Page.navigate', { url: 'file://' + REDIRECT })
  await waitTitle('Field Notes · Demo')
  await sleep(1500)
  const stored = JSON.parse(await evalJs(`localStorage.getItem('trailhead.session')`))
  assert.equal(typeof stored.id, 'string', 'regenerated session id is a string')
  assert.ok(stored.id.length > 0, 'regenerated session id is non-empty')
  assert.ok(Number.isFinite(stored.last), 'regenerated session activity is finite')
  const sessionId = stored.id
  console.log('malformed session regenerated: ' + sessionId.slice(0, 8) + '…')
  // 3. A real pointer click at viewport (200, 300).
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 200, y: 300, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 200, y: 300, button: 'left', clickCount: 1 })
  await sleep(1500)
  console.log('pointer click recorded')
  // 4. Follow the link to the second demo page (same session, new page view).
  await evalJs(`document.querySelector('a[href="/trail.html"]').click(); 'ok'`)
  await waitTitle('Routes on the list · Field Notes')
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 200, y: 300, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 200, y: 300, button: 'left', clickCount: 1 })
  await sleep(1500)
  console.log('trail page loaded, second click recorded')
  // 5. Verify via the API: one session, two page views, clicks in the
  // journey and the heatmap.
  const journey = await api('/api/sessions/' + sessionId)
  const views = journey.filter(e => e.type === 'page_view')
  assert.equal(views.length, 2, 'two page views, got ' + views.length)
  assert.deepEqual(views.map(e => new URL(e.url).pathname), ['/demo.html', '/trail.html'], 'page views in visit order')
  const clicks = journey.filter(e => e.type === 'click')
  assert.ok(clicks.length >= 2, 'clicks in the journey, got ' + clicks.length)
  console.log('journey clicks:', JSON.stringify(clicks.map(e => ({ x: e.x, y: e.y, pointer: e.pointer }))))
  // The two real pointer clicks carry the flag; the scripted link click
  // (0, 0, detail 0) correctly does not.
  const pointerClicks = clicks.filter(e => e.x === 200 && e.y === 300)
  assert.ok(pointerClicks.length >= 2, 'real pointer clicks recorded, got ' + pointerClicks.length)
  assert.ok(pointerClicks.every(e => e.pointer === true), 'clicks carry the pointer flag')
  const heat = await api('/api/clicks?url=' + encodeURIComponent(base + '/demo.html'))
  assert.ok(heat.some(p => p.x === 200 && p.y === 300), 'demo click on the heatmap')
  console.log('session ' + sessionId.slice(0, 8) + '…: ' + journey.length + ' events, heatmap has the click')
  // 6. Double inclusion (M7): inject the tracker twice on the dashboard page
  // and check only one page view is recorded for it.
  await evalJs(`document.querySelector('header a[href="/"]').click(); 'ok'`)
  await waitTitle('Trailhead · Session analytics')
  await sleep(4000)
  const dashText = await evalJs(`document.getElementById('app').innerText`)
  assert.ok(dashText.includes(sessionId.slice(0, 8)), 'dashboard shows the session')
  assert.ok(/Updated \d/.test(dashText), 'dashboard shows an Updated time')
  const inject = `(() => { const s = document.createElement('script'); s.async = true; s.src = '/tracker.js'; document.head.appendChild(s); return 'injected' })()`
  await evalJs(inject)
  await sleep(2000)
  await evalJs(inject)
  await sleep(2000)
  const after = await api('/api/sessions/' + sessionId)
  assert.equal(after.filter(e => e.type === 'page_view' && new URL(e.url).pathname === '/').length, 1, 'double inclusion recorded one page view')
  console.log('double inclusion guard holds: one dashboard page view')
  // 7. Auto-refresh (M1/L2): the Updated time advances on its own.
  const before = await evalJs(`document.getElementById('app').innerText`)
  const updatedBefore = before.match(/Updated ([0-9: ]+[AP]M)/)?.[1]
  const stop = Date.now() + 20000
  let updatedAfter = updatedBefore
  while (Date.now() < stop) {
    await sleep(1000)
    const text = await evalJs(`document.getElementById('app').innerText`)
    updatedAfter = text.match(/Updated ([0-9: ]+[AP]M)/)?.[1]
    if (updatedAfter && updatedAfter !== updatedBefore) break
  }
  assert.ok(updatedAfter && updatedAfter !== updatedBefore, 'Updated time advanced (' + updatedBefore + ' -> ' + updatedAfter + ')')
  console.log('auto-refresh advanced Updated: ' + updatedBefore + ' -> ' + updatedAfter)
  // 8. Heatmap view renders the recorded clicks as dots. The page list
  // defaults to '/' (the dashboard page view), which has no clicks, so
  // select the demo page explicitly.
  await evalJs(`[...document.querySelectorAll('nav button')].find(b => b.textContent === 'Click map').click(); 'ok'`)
  await sleep(2500)
  await evalJs(`const sel = document.querySelector('select'); const opt = [...sel.options].find(o => o.value.endsWith('/demo.html')); sel.value = opt.value; sel.dispatchEvent(new Event('change', {bubbles: true})); 'ok'`)
  await sleep(2500)
  const dots = await evalJs(`document.querySelectorAll('.map i').length`)
  assert.ok(dots >= 1, 'heatmap dots rendered, got ' + dots)
  console.log('heatmap view renders ' + dots + ' dot(s)')
  ws.close()
  console.log('Smoke test passed.')
}

try {
  await main()
} catch (err) {
  console.error('Smoke test failed: ' + (err?.message || err))
  process.exitCode = 1
} finally {
  if (chrome) chrome.kill()
  server.kill()
  try {
    client = new MongoClient(mongoUri)
    await client.connect()
    await client.db().dropDatabase()
    await client.close()
    console.log('Dropped throwaway database ' + dbName + '.')
  } catch (err) {
    console.error('Could not drop the throwaway database ' + dbName + ': ' + err.message)
  }
}
