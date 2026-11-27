const h = React.createElement
const { useState, useEffect, useRef, useCallback } = React

// Requests in flight across all dashboard views. The auto-refresh poller
// (M1) waits for this to reach zero before scheduling the next fetch, so a
// slow request is never cut off mid-flight.
let inFlight = 0
const settleWaiters = []
function trackFetch(promise) {
  inFlight++
  const done = () => {
    inFlight--
    if (inFlight === 0) settleWaiters.splice(0).forEach(f => f())
  }
  promise.then(done, done)
  return promise
}

// Fetches one path for the current revision. The previous request is never
// aborted: a stale response is simply ignored, and the last good data stays
// visible while the next fetch runs (M1). result.loading tells the view a
// refresh is in progress; result.error keeps the old data beside the failure.
function useData(path, revision, hooks = {}) {
  const [result, set] = useState({})
  const latest = useRef(0)
  useEffect(() => {
    if (!path) return
    const seq = ++latest.current
    set(prev => ({ ...prev, loading: true, error: undefined }))
    trackFetch(fetch(path).then(r => {
      if (!r.ok) throw Error('Request failed')
      return r.json()
    }).then(data => {
      if (seq !== latest.current) return
      set({ path, revision, data, loading: false })
      hooks.onSuccess?.()
    }).catch(e => {
      if (seq !== latest.current) return
      set(prev => ({ ...prev, path, revision, loading: false, error: e.message }))
      hooks.onError?.()
    }))
    return () => { latest.current++ }
  }, [path, revision])
  return result
}
function content(result, empty, render) {
  if (result.error && !result.data) return h('p', { role: 'alert' }, 'Could not load data. Use Refresh to try again.')
  if (!result.data) return h('p', null, 'Loading…')
  return h(React.Fragment, null,
    result.loading ? h('p', null, 'Refreshing…') : null,
    result.error ? h('p', { role: 'alert' }, 'Refresh failed — showing the last good data.') : null,
    result.data.length ? render(result.data) : h('p', null, empty))
}
function offset(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  if (m < 60) return m + 'm ' + (s % 60) + 's'
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'
}
// Journey rows show the event time the tracker sent; the sessions list shows
// the server receipt span. Both order by event time, then receipt time.
const when = e => new Date(e.timestamp)
function Sessions({ revision, onSuccess, onError }) {
  const list = useData('/api/sessions', revision, { onSuccess, onError })
  const [selected, select] = useState('')
  const id = selected || list.data?.[0]?._id
  const journey = useData(id && '/api/sessions/' + encodeURIComponent(id), revision)
  return h('div', { className: 'columns' },
    h('article', null, h('h2', null, 'Sessions'), content(list, 'Open the demo to record your first session.', rows => rows.map(row =>
      h('button', { key: row._id, className: 'row', title: row._id, 'aria-pressed': row._id === id, onClick: () => select(row._id) },
        h('strong', null, row._id.slice(0, 8)), h('span', null, row.count + ' events · ' + offset(new Date(row.last) - new Date(row.first)) + ' · started ' + new Date(row.first).toLocaleTimeString()), h('small', null, row.firstUrl), h('small', null, 'Last seen ' + new Date(row.last).toLocaleString()))))),
    h('article', null, h('h2', null, 'User journey'), id ? content(journey, 'No events in this session.', rows => h('ol', null, rows.map(e =>
      h('li', { key: e._id }, h('strong', null, e.type === 'click' ? 'Click' : 'Page view'), h('time', null, when(e).toLocaleString() + ' · +' + offset(when(e) - when(rows[0]))), h('small', null, e.url),
        e.type === 'click' && h('small', null, 'Position (' + e.x + ', ' + e.y + ')'))))) : h('p', null, 'Select a session to see its events.')))
}
function Heatmap({ revision, onSuccess, onError }) {
  const pages = useData('/api/pages', revision, { onSuccess, onError })
  const [selected, select] = useState('')
  const url = selected || pages.data?.[0]
  const clicks = useData(url && '/api/clicks?url=' + encodeURIComponent(url), revision)
  return h('article', null, h('h2', null, 'Click map'), content(pages, 'Visit the demo to add a page.', urls =>
    h('div', null, h('label', null, 'Page URL ', h('select', { value: url, onChange: e => select(e.target.value) }, urls.map(u => h('option', { key: u }, u)))),
      content(clicks, 'This page has no recorded clicks.', points => {
        const cells = {}
        for (const p of points) {
          const cell = Math.min(9, Math.floor(10 * p.x / p.width)) + ',' + Math.min(9, Math.floor(10 * p.y / p.height))
          cells[cell] = (cells[cell] || 0) + 1
        }
        const max = Math.max(...Object.values(cells))
        return h('div', null, h('p', null, points.length + ' clicks · Positions relative to the full document'),
          h('p', null, 'Darker = more clicks in that spot'),
          h('div', { className: 'map', role: 'img', 'aria-label': 'Click positions from top left to bottom right' }, points.map((p, i) => {
            const cell = Math.min(9, Math.floor(10 * p.x / p.width)) + ',' + Math.min(9, Math.floor(10 * p.y / p.height))
            const strength = cells[cell] / max
            return h('i', { key: i, style: { left: (100 * p.x / p.width) + '%', top: (100 * p.y / p.height) + '%', opacity: 0.35 + 0.65 * strength, width: (14 + 10 * strength) + 'px', height: (14 + 10 * strength) + 'px' } })
          })))
      }))))
}
function App() {
  const [view, set] = useState('Sessions')
  const [revision, refresh] = useState(0)
  const [updated, setUpdated] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [failed, setFailed] = useState(false)
  // "Updated" advances only when the active view's data loads (L2).
  const markUpdated = useCallback(() => { setUpdated(new Date().toLocaleTimeString()); setFailed(false) }, [])
  const markFailed = useCallback(() => setFailed(true), [])
  useEffect(() => {
    let stopped = false
    let timer
    const tick = () => {
      if (stopped) return
      if (inFlight > 0) { timer = setTimeout(tick, 1000); return }
      refresh(v => v + 1)
      timer = setTimeout(tick, 10000)
    }
    timer = setTimeout(tick, 10000)
    return () => { stopped = true; clearTimeout(timer) }
  }, [])
  useEffect(() => {
    const timer = setInterval(() => setRefreshing(inFlight > 0), 250)
    return () => clearInterval(timer)
  }, [])
  return h(React.Fragment, null, h('p', { className: 'eyebrow' }, 'SITE ANALYTICS'), h('h1', null, 'Visitor activity'),
    h('nav', null, ...['Sessions', 'Click map'].map(v => h('button', { key: v, 'aria-pressed': view === v, onClick: () => set(v) }, v)),
      h('button', { className: 'refresh', onClick: () => refresh(v => v + 1) }, 'Refresh'),
      updated && h('small', null, 'Updated ' + updated),
      refreshing && h('small', null, 'Refreshing…'),
      failed && !refreshing && h('small', null, 'Refresh failed — showing the last good data')),
    h(view === 'Sessions' ? Sessions : Heatmap, { revision, onSuccess: markUpdated, onError: markFailed }))
}
ReactDOM.createRoot(document.getElementById('app')).render(h(App))
