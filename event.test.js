import test from 'node:test'
import assert from 'node:assert/strict'
import {parseEvent} from './event.js'
const view = {session_id:'session-123',type:'page_view',timestamp:'2026-01-01T10:00:00Z',url:'https://example.com/demo?secret=abc#notes'}
test('keeps only the origin and path',()=>assert.equal(parseEvent(view).url,'https://example.com/demo'))
test('stores dates chronologically as BSON-compatible dates',()=>assert.ok(parseEvent(view).timestamp instanceof Date))
test('preserves the top left click',()=>assert.equal(parseEvent({...view,type:'click',x:0,y:0,width:320,height:640}).x,0))
test('rejects malformed events', () => {
  for (const bad of [{ timestamp: null }, { session_id: {} }, { url: 'file:///etc' }, { url: 123 }, { type: 'scroll' }, { type: 'click', x: 321, y: 0, width: 320, height: 640 }, { type: 'click', x: 0, y: 0, width: 200000, height: 640 }, { timestamp: '2019-06-01T00:00:00Z' }, { timestamp: new Date(Date.now() + 2 * 86400000).toISOString() }, { type: 'click', x: 0, y: 0, width: 320, height: 640, pointer: 'yes' }])
    assert.throws(() => parseEvent({ ...view, ...bad }))
})
test('records the pointer flag on clicks', () => {
  assert.equal(parseEvent({ ...view, type: 'click', x: 0, y: 0, width: 320, height: 640, pointer: true }).pointer, true)
  assert.equal(parseEvent({ ...view, type: 'click', x: 0, y: 0, width: 320, height: 640, pointer: false }).pointer, false)
  assert.equal(parseEvent({ ...view, type: 'click', x: 0, y: 0, width: 320, height: 640 }).pointer, false)
})
