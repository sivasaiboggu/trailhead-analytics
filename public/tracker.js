(() => {
  const endpoint = new URL('/api/events', document.currentScript.src)
  const key = 'trailhead.session'
  let current
  function send(type, geometry = {}) {
    const now = Date.now()
    try { current = JSON.parse(localStorage.getItem(key)) || current } catch {}
    if (!current?.id || now - current.last >= 1800000)
      current = {id: crypto.randomUUID ? crypto.randomUUID() : now.toString(36)+'-'+Math.random().toString(36).slice(2)}
    current.last = now
    try { localStorage.setItem(key, JSON.stringify(current)) } catch {}
    fetch(endpoint, {method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',keepalive:true,
      body:JSON.stringify({session_id:current.id,type,url:location.origin+location.pathname,timestamp:new Date(now).toISOString(),...geometry})
    }).catch(() => {})
  }
  send('page_view')
  document.addEventListener('click', e => {
    const root = document.documentElement
    send('click',{x:e.pageX,y:e.pageY,width:Math.max(root.clientWidth,root.scrollWidth),height:Math.max(root.clientHeight,root.scrollHeight)})
  }, true)
})()
