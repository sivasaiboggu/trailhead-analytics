import test from 'node:test'
import assert from 'node:assert/strict'
import {parseEvent} from './event.js'
const view = {session_id:'session-123',type:'page_view',timestamp:'2026-01-01T10:00:00Z',url:'https://example.com/demo?secret=abc#notes'}
test('keeps only the origin and path',()=>assert.equal(parseEvent(view).url,'https://example.com/demo'))
test('stores dates chronologically as BSON-compatible dates',()=>assert.ok(parseEvent(view).timestamp instanceof Date))
test('preserves the top left click',()=>assert.equal(parseEvent({...view,type:'click',x:0,y:0,width:320,height:640}).x,0))
test('rejects malformed events',()=>{
  for (const bad of [{timestamp:null},{session_id:{}},{url:'file:///etc'},{type:'scroll'},{type:'click',x:321,y:0,width:320,height:640}])
    assert.throws(()=>parseEvent({...view,...bad}))
})
