import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { MongoClient } from 'mongodb'
import { setTimeout as delay } from 'node:timers/promises'

// The check runs against its own throwaway database (M9) on an OS-assigned
// port (L6). It never touches the development database, even when MONGODB_URI
// is set in the environment, and the database is dropped afterwards.
const dbName = 'trailhead_check_' + randomBytes(4).toString('hex')
const mongoUri = 'mongodb://127.0.0.1:27017/' + dbName
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
const port = await listeningPort()
const base = 'http://127.0.0.1:' + port
const session = randomUUID()
const url = base + '/demo.html'
const view = { session_id: session, type: 'page_view', url, timestamp: '2026-01-01T10:00:00Z' }
const click = { ...view, type: 'click', x: 40, y: 80, width: 400, height: 800, pointer: true, timestamp: '2026-01-01T10:00:05Z' }
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
  const deadline = Date.now() + 10000
  while (true) {
    const ready = await fetch(base + '/').catch(() => null)
    if (ready?.ok) break
    if (Date.now() >= deadline) throw Error('Server startup timed out')
    await delay(250)
  }
  for (const path of ['/demo.html', '/trail.html', '/tracker.js', '/dashboard.js', '/vendor/react.js', '/vendor/reactdom.js']) {
    assert.equal((await fetch(base + path)).status, 200, path)
  }
  // Health probe and the nosniff header on every response.
  const health = await fetch(base + '/health')
  assert.equal(health.status, 200, 'health')
  assert.deepEqual(await health.json(), { status: 'ok' })
  assert.equal((await fetch(base + '/')).headers.get('x-content-type-options'), 'nosniff', 'nosniff header')
  assert.equal((await post({})).status, 400)
  assert.equal((await postRaw('{not json')).status, 400, 'malformed JSON')
  assert.equal((await post({ ...view, url: 123 })).status, 400, 'url must be a string')
  assert.equal((await post({ ...view, timestamp: '2019-06-01T00:00:00Z' })).status, 400, 'timestamp before 2020')
  assert.equal((await post({ ...view, timestamp: new Date(Date.now() + 2 * 86400000).toISOString() })).status, 400, 'timestamp more than a day ahead')
  assert.equal((await post({ ...click, width: 200000 })).status, 400, 'document width out of bounds')
  const options = await fetch(base + '/api/events', { method: 'OPTIONS' })
  assert.equal(options.status, 204, 'OPTIONS')
  assert.equal(options.headers.get('access-control-allow-origin'), null, 'no CORS grant without an origin')
  const sameOrigin = await fetch(base + '/api/events', { method: 'OPTIONS', headers: { Origin: base } })
  assert.equal(sameOrigin.status, 204, 'OPTIONS same-origin')
  assert.equal(sameOrigin.headers.get('access-control-allow-origin'), base, 'CORS reflects the same origin')
  const foreign = await fetch(base + '/api/events', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })
  assert.equal(foreign.status, 204, 'OPTIONS foreign origin')
  assert.equal(foreign.headers.get('access-control-allow-origin'), null, 'no CORS grant for a foreign origin')
  assert.equal((await fetch(base + '/api/clicks')).status, 400, 'clicks without url')
  // Insert out of order to exercise chronological journey sorting.
  for (const event of [click, view]) assert.equal((await post(event)).status, 201)
  const sessions = await read('/api/sessions')
  const row = sessions.find(row => row._id === session)
  assert.equal(row?.count, 2)
  assert.ok(row.first, 'session first activity present')
  assert.ok(new Date(row.first) <= new Date(row.last), 'first activity no later than last')
  assert.equal(row.firstUrl, url, 'first page is the first received event')
  const journey = await read('/api/sessions/' + session)
  assert.deepEqual(journey.map(event => event.type), ['page_view', 'click'])
  assert.ok(journey.every(event => event.receivedAt), 'server receipt time recorded')
  // Same-timestamp events (M2): the journey must follow insertion order, and
  // the sessions list must agree on the first page.
  const tied = randomUUID()
  const tiedAt = '2026-01-01T10:00:00Z'
  const trailUrl = base + '/trail.html'
  for (const event of [
    { session_id: tied, type: 'click', url, timestamp: tiedAt, x: 10, y: 10, width: 100, height: 100, pointer: true },
    { session_id: tied, type: 'page_view', url: trailUrl, timestamp: tiedAt }
  ]) assert.equal((await post(event)).status, 201)
  assert.deepEqual((await read('/api/sessions/' + tied)).map(event => event.type), ['click', 'page_view'], 'same-timestamp order follows receipt')
  assert.equal((await read('/api/sessions')).find(row => row._id === tied)?.firstUrl, url, 'same-timestamp first page')
  // A keyboard click (L5) stays in the journey but never reaches the heatmap.
  const keyboard = randomUUID()
  assert.equal((await post({ session_id: keyboard, type: 'click', url: trailUrl, timestamp: '2026-01-01T10:00:00Z', x: 0, y: 0, width: 400, height: 800, pointer: false })).status, 201)
  assert.equal((await read('/api/sessions/' + keyboard)).length, 1, 'keyboard click in the journey')
  assert.deepEqual(await read('/api/clicks?url=' + encodeURIComponent(trailUrl)), [], 'keyboard click excluded from the heatmap')
  assert.deepEqual(await read('/api/sessions/' + randomUUID()), [], 'unknown session')
  assert.ok((await read('/api/pages')).includes(url))
  const positions = await read('/api/clicks?url=' + encodeURIComponent(url))
  assert.ok(positions.some(p => p.x === 40 && p.y === 80 && p.width === 400 && p.height === 800))
  console.log('Passed ingestion, session count, first/last activity, journey order, same-timestamp order, pointer heatmap filter, page list, click geometry, malformed JSON, OPTIONS/CORS, clicks without url, unknown session and asset checks.')
} finally {
  server.kill()
  try {
    const client = new MongoClient(mongoUri)
    await client.connect()
    await client.db().dropDatabase()
    await client.close()
    console.log('Dropped throwaway database ' + dbName + '.')
  } catch (err) {
    console.error('Could not drop the throwaway database ' + dbName + ': ' + err.message)
  }
}
