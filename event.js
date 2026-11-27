const EARLIEST = Date.parse('2020-01-01T00:00:00Z')
const MAX_DOCUMENT = 100000
export function parseEvent(body) {
  const { session_id, type, timestamp, url } = body ?? {}
  if (typeof session_id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(session_id)) throw Error('Invalid session ID')
  if (!['click', 'page_view'].includes(type)) throw Error('Invalid event type')
  if (typeof url !== 'string') throw Error('Invalid URL')
  const page = new URL(url)
  if (!['https:', 'http:'].includes(page.protocol)) throw Error('Invalid URL')
  const time = new Date(timestamp)
  if (typeof timestamp !== 'string' || !Number.isFinite(+time)) throw Error('Invalid timestamp')
  // A client clock may drift, but not by years (M8): reject timestamps before
  // 2020 or more than one day in the future.
  if (+time < EARLIEST || +time > Date.now() + 86400000) throw Error('Timestamp outside the sane window')
  const event = { session_id, type, timestamp: time, url: page.origin + page.pathname }
  if (type === 'click') {
    if ('pointer' in body && typeof body.pointer !== 'boolean') throw Error('Invalid pointer flag')
    // pointer records whether a real pointer produced the click (L5).
    // Keyboard-triggered clicks carry pointer: false and stay out of the
    // heatmap; a missing flag is treated the same way.
    event.pointer = body.pointer === true
    for (const [axis, size] of [['x', 'width'], ['y', 'height']]) {
      if (!Number.isFinite(body[size]) || body[size] <= 0 || body[size] > MAX_DOCUMENT || !Number.isFinite(body[axis]) || body[axis] < 0 || body[axis] > body[size]) throw Error('Invalid click geometry')
      event[axis] = body[axis]
      event[size] = body[size]
    }
  }
  return event
}
