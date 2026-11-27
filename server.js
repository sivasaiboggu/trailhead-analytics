import express from 'express'
import { MongoClient } from 'mongodb'
import { resolve } from 'node:path'
import { parseEvent } from './event.js'

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/trailhead'
// Bound to loopback by default (H2): the read APIs are anonymous and this is a
// demo-only build. An operator who serves it more widely must put auth in
// front of the read routes; set HOST only when that is in place.
const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 3000)

// One startup error boundary for the whole MongoDB setup (L1): client
// construction, connect and index creation. The connection string is never
// printed — it may carry credentials (H1). Only the failed stage and the
// driver's error name are reported.
let events
{
  let stage = 'parse connection string'
  try {
    const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 3000 })
    stage = 'connect'
    await client.connect()
    events = client.db().collection('events')
    stage = 'create indexes'
    await events.createIndex({ session_id: 1, timestamp: 1, receivedAt: 1 })
    await events.createIndex({ type: 1, url: 1 })
  } catch (err) {
    console.error(`MongoDB startup failed at ${stage} (${err.name || 'error'}) — check that MongoDB is running or set MONGODB_URI`)
    process.exit(1)
  }
}

// The newest 100 sessions and the newest 1000 events of one journey (M3).
// The bounds keep a demo deployment from returning unbounded histories.
const SESSION_LIMIT = 100
const JOURNEY_LIMIT = 1000
const CLICK_LIMIT = 5000

const app = express()
app.disable('x-powered-by')

// CORS allow-list (M6). With ALLOWED_ORIGINS unset the API answers only
// same-origin callers: the tracker is served from this origin in the demo.
// Operators embedding the tracker elsewhere set ALLOWED_ORIGINS to a
// comma-separated list of origins, e.g. "https://shop.example.com".
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
function corsOrigin(req) {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || !origin) return null
  if (allowedOrigins.includes(origin)) return origin
  if (origin === `${req.protocol}://${req.get('host')}`) return origin
  return null
}
app.use('/api/events', (req, res, next) => {
  const origin = corsOrigin(req)
  if (origin) res.set({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin' })
  res.set({ 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' })
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})
app.use(express.json({ limit: '8kb' }))
app.post('/api/events', async (req, res) => {
  let event
  try { event = parseEvent(req.body) } catch { return res.status(400).json({ error: 'Invalid event' }) }
  // Server-side receipt time (M8): the ordering key for sessions, journeys
  // and durations. The client timestamp is kept with the event.
  event.receivedAt = new Date()
  await events.insertOne(event)
  res.sendStatus(201)
})
app.get('/api/sessions', async (_, res) => res.json(await events.aggregate([
  // One tie-breaker everywhere (M2): event time, then server receipt time,
  // then insertion order. The same order drives the journey query, so the
  // sessions list and the journey can no longer disagree on the first page.
  // First/last activity is the server receipt span (M8).
  { $sort: { timestamp: 1, receivedAt: 1, _id: 1 } },
  { $group: { _id: '$session_id', count: { $sum: 1 }, first: { $min: '$receivedAt' }, last: { $max: '$receivedAt' }, firstUrl: { $first: '$url' } } },
  { $sort: { last: -1, _id: 1 } },
  { $limit: SESSION_LIMIT }
]).toArray()))
app.get('/api/sessions/:id', async (req, res) => res.json(await events.find({ session_id: req.params.id }).sort({ timestamp: 1, receivedAt: 1, _id: 1 }).limit(JOURNEY_LIMIT).toArray()))
app.get('/api/pages', async (_, res) => res.json((await events.distinct('url')).sort()))
app.get('/api/clicks', async (req, res) => {
  if (typeof req.query.url !== 'string') return res.status(400).json({ error: 'URL required' })
  // The heatmap shows real pointer clicks only (L5). Keyboard-triggered
  // clicks stay in the journey but never land on the map.
  res.json(await events.find({ type: 'click', url: req.query.url, pointer: true }, { projection: { _id: 0, x: 1, y: 1, width: 1, height: 1 } }).limit(CLICK_LIMIT).toArray())
})
for (const [name, path] of Object.entries({ react: 'react/umd/react.production.min.js', reactdom: 'react-dom/umd/react-dom.production.min.js' }))
  app.get('/vendor/' + name + '.js', (_, res) => res.sendFile(resolve('node_modules', path)))
app.use(express.static('public'))
app.use((err, req, res, next) => { console.error(err.message); res.status(err.status || 500).json({ error: 'Request failed' }) })
const server = app.listen(port, host, () => {
  console.log(`Trailhead listening on http://${host}:${server.address().port}`)
})
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use`)
    process.exit(1)
  }
  throw err
})
