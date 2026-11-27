(() => {
  try {
  // Capture this script's URL while it is executing (M4). document.currentScript
  // is only set for classic scripts; the fallback matches a <script> whose path
  // ends in tracker.js, so tracker.js?v=2 still resolves. With several matches
  // the last one in document order is the most recently added.
  const isTrackerSrc = src => {
    try { return new URL(src, location.href).pathname.endsWith('/tracker.js') } catch { return false }
  }
  const scriptEl = document.currentScript
  const candidates = [...document.querySelectorAll('script[src]')].filter(s => isTrackerSrc(s.src))
  const scriptSrc = scriptEl?.src || candidates.at(-1)?.src || null
  const endpoint = new URL('/api/events', scriptSrc || location.origin)
  if (!scriptSrc && (location.hostname === 'localhost' || location.hostname === '127.0.0.1'))
    console.warn('[trailhead] could not determine the tracker script URL; sending events to the page origin')
  // One installation per document and collector (M7): including this script
  // twice for the same endpoint must not double-count page views.
  const installed = window.__trailheadTrackers || (window.__trailheadTrackers = {})
  if (installed[endpoint.href]) return
  installed[endpoint.href] = true
  const key = 'trailhead.session'
  function validSession(value) {
    return !!value && typeof value.id === 'string' && value.id.length > 0 && Number.isFinite(value.last)
  }
  // The stored session is only reused when it is well formed (M5): a
  // non-empty string id and a finite activity time. Anything else is
  // discarded and a fresh session is generated.
  function loadSession() {
    try {
      const stored = JSON.parse(localStorage.getItem(key))
      return validSession(stored) ? stored : null
    } catch { return null }
  }
  let session = null
  function send(type, geometry = {}) {
    const now = Date.now()
    const stored = loadSession()
    if (stored) session = stored
    if (!validSession(session) || now - session.last >= 1800000)
      session = { id: crypto.randomUUID ? crypto.randomUUID() : now.toString(36) + '-' + Math.random().toString(36).slice(2), last: now }
    session.last = now
    try { localStorage.setItem(key, JSON.stringify(session)) } catch {}
    fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', keepalive: true,
      body: JSON.stringify({ session_id: session.id, type, url: location.origin + location.pathname, timestamp: new Date(now).toISOString(), ...geometry })
    }).catch(() => {})
  }
  send('page_view')
  document.addEventListener('click', e => {
    const root = document.documentElement
    // A keyboard-triggered click has detail 0; a real pointer click counts
    // (L5). Coordinates are document-relative, including the scrolled part.
    send('click', { x: e.pageX, y: e.pageY, width: Math.max(root.clientWidth, root.scrollWidth), height: Math.max(root.clientHeight, root.scrollHeight), pointer: e.detail > 0 })
  }, true)
  } catch {}
})()
