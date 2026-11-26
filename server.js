import express from 'express'
import { MongoClient } from 'mongodb'
import { resolve } from 'node:path'
import { parseEvent } from './event.js'

const db = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/trailhead')
await db.connect()
const events = db.db().collection('events')
await events.createIndex({session_id:1,timestamp:1})
await events.createIndex({type:1,url:1})
const app = express()
app.disable('x-powered-by')
app.use('/api/events', (req,res,next) => {
  res.set({'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS'})
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})
app.use(express.json({limit:'8kb'}))
app.post('/api/events', async (req,res) => {
  let event
  try { event = parseEvent(req.body) } catch { return res.status(400).json({error:'Invalid event'}) }
  await events.insertOne(event)
  res.sendStatus(201)
})
app.get('/api/sessions', async (_,res) => res.json(await events.aggregate([
  {$group:{_id:'$session_id',count:{$sum:1},last:{$max:'$timestamp'}}}, {$sort:{last:-1,_id:1}}
]).toArray()))
app.get('/api/sessions/:id', async (req,res) => res.json(await events.find({session_id:req.params.id}).sort({timestamp:1,_id:1}).toArray()))
app.get('/api/pages', async (_,res) => res.json((await events.distinct('url')).sort()))
app.get('/api/clicks', async (req,res) => {
  if (typeof req.query.url !== 'string') return res.status(400).json({error:'URL required'})
  res.json(await events.find({type:'click',url:req.query.url},{projection:{_id:0,x:1,y:1,width:1,height:1}}).toArray())
})
for (const [name,path] of Object.entries({react:'react/umd/react.production.min.js',reactdom:'react-dom/umd/react-dom.production.min.js'}))
  app.get('/vendor/'+name+'.js', (_,res) => res.sendFile(resolve('node_modules',path)))
app.use(express.static('public'))
app.use((err,req,res,next) => { console.error(err.message); res.status(err.status || 500).json({error:'Request failed'}) })
app.listen(process.env.PORT || 3000)

