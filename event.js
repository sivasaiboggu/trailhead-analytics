export function parseEvent(body) {
  const {session_id, type, timestamp, url} = body ?? {}
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(String(session_id)) || typeof session_id !== 'string') throw Error('Invalid session ID')
  if (!['click', 'page_view'].includes(type)) throw Error('Invalid event type')
  const page = new URL(url)
  if (!['https:', 'http:'].includes(page.protocol)) throw Error('Invalid URL')
  const time = new Date(timestamp)
  if (typeof timestamp !== 'string' || !Number.isFinite(+time)) throw Error('Invalid timestamp')
  const event = {session_id, type, timestamp: time, url: page.origin + page.pathname}
  if (type === 'click') {
    for (const [axis, size] of [['x','width'], ['y','height']]) {
      if (!Number.isFinite(body[size]) || body[size] <= 0 || !Number.isFinite(body[axis]) || body[axis] < 0 || body[axis] > body[size]) throw Error('Invalid click geometry')
      event[axis] = body[axis]
      event[size] = body[size]
    }
  }
  return event
}
