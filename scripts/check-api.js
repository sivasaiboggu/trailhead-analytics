import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const port = 3187
const base = 'http://127.0.0.1:' + port
const server = spawn(process.execPath, ['server.js'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: String(port) }
})
const session = randomUUID()
const url = base + '/demo.html'
const view = { session_id: session, type: 'page_view', url, timestamp: '2026-01-01T10:00:00Z' }
const click = { ...view, type: 'click', x: 40, y: 80, width: 400, height: 800, timestamp: '2026-01-01T10:00:05Z' }
const post = data => fetch(base + '/api/events', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
})
const postRaw = body => fetch(base + '/api/events', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body
})
async function read(path) {
  const response = await fetch(base + path)
  assert.equal(response.status, 200)
  return response.json()
}
try {
  const deadline = Date.now() + 40000
  while (true) {
    if (server.exitCode !== null) throw Error('Server exited during startup')
    const ready = await fetch(base + '/').catch(() => null)
    if (ready?.ok) break
    if (Date.now() >= deadline) throw Error('Server startup timed out')
    await delay(250)
  }
  for (const path of ['/demo.html','/trail.html','/tracker.js','/dashboard.js','/vendor/react.js','/vendor/reactdom.js']) {
    assert.equal((await fetch(base + path)).status, 200, path)
  }
  assert.equal((await post({})).status, 400)
  assert.equal((await postRaw('{not json')).status, 400, 'malformed JSON')
  const options = await fetch(base + '/api/events', {method: 'OPTIONS'})
  assert.equal(options.status, 204, 'OPTIONS')
  assert.equal(options.headers.get('access-control-allow-origin'), '*', 'CORS origin')
  assert.equal((await fetch(base + '/api/clicks')).status, 400, 'clicks without url')
  // Insert out of order to exercise chronological journey sorting.
  for (const event of [click, view]) assert.equal((await post(event)).status, 201)
  const sessions = await read('/api/sessions')
  const row = sessions.find(row => row._id === session)
  assert.equal(row?.count, 2)
  assert.ok(row.first, 'session first activity present')
  assert.ok(new Date(row.first) <= new Date(row.last), 'first activity no later than last')
  const journey = await read('/api/sessions/' + session)
  assert.deepEqual(journey.map(event => event.type), ['page_view', 'click'])
  assert.deepEqual(await read('/api/sessions/' + randomUUID()), [], 'unknown session')
  assert.ok((await read('/api/pages')).includes(url))
  const positions = await read('/api/clicks?url=' + encodeURIComponent(url))
  assert.ok(positions.some(p => p.x === 40 && p.y === 80 && p.width === 400 && p.height === 800))
  console.log('Passed ingestion, session count, first/last activity, journey order, page list, click geometry, malformed JSON, OPTIONS/CORS, clicks without url, unknown session and asset checks.')
} finally {
  server.kill()
}
