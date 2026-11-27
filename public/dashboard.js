const h = React.createElement
const {useState,useEffect} = React
function useData(path, revision) {
  const [result,set] = useState({})
  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    fetch(path,{signal:controller.signal}).then(r => {
      if (!r.ok) throw Error('Request failed')
      return r.json()
    }).then(data => set({path,revision,data})).catch(e => {
      if (!controller.signal.aborted) set({path,revision,error:e.message})
    })
    return () => controller.abort()
  },[path,revision])
  return result.path === path && result.revision === revision ? result : {}
}
function content(result, empty, render) {
  if (result.error) return h('p',{role:'alert'},'Could not load data. Use Refresh to try again.')
  if (!result.data) return h('p',null,'Loading…')
  return result.data.length ? render(result.data) : h('p',null,empty)
}
function offset(ms) {
  const s = Math.max(0, Math.round(ms/1000))
  if (s < 60) return s+'s'
  const m = Math.floor(s/60)
  if (m < 60) return m+'m '+(s%60)+'s'
  return Math.floor(m/60)+'h '+(m%60)+'m'
}
function Sessions({revision}) {
  const list = useData('/api/sessions',revision)
  const [selected,select] = useState('')
  const id = selected || list.data?.[0]?._id
  const journey = useData(id && '/api/sessions/'+encodeURIComponent(id),revision)
  return h('div',{className:'columns'},
    h('article',null,h('h2',null,'Sessions'),content(list,'Open the demo to record your first session.',rows => rows.map(row =>
      h('button',{key:row._id,className:'row',title:row._id,'aria-pressed':row._id===id,onClick:()=>select(row._id)},
      h('strong',null,row._id.slice(0,8)),h('span',null,row.count+' events · '+offset(new Date(row.last)-new Date(row.first))+' · started '+new Date(row.first).toLocaleTimeString()),h('small',null,row.firstUrl),h('small',null,'Last seen '+new Date(row.last).toLocaleString()))))),
    h('article',null,h('h2',null,'User journey'),id ? content(journey,'No events in this session.',rows => h('ol',null,rows.map(e =>
      h('li',{key:e._id},h('strong',null,e.type==='click'?'Click':'Page view'),h('time',null,new Date(e.timestamp).toLocaleString()+' · +'+offset(new Date(e.timestamp)-new Date(rows[0].timestamp))),h('small',null,e.url),
        e.type==='click' && h('small',null,'Position ('+e.x+', '+e.y+')'))))) : h('p',null,'Select a session to see its events.')))
}
function Heatmap({revision}) {
  const pages = useData('/api/pages',revision)
  const [selected,select] = useState('')
  const url = selected || pages.data?.[0]
  const clicks = useData(url && '/api/clicks?url='+encodeURIComponent(url),revision)
  return h('article',null,h('h2',null,'Click map'),content(pages,'Visit the demo to add a page.',urls =>
    h('div',null,h('label',null,'Page URL ',h('select',{value:url,onChange:e=>select(e.target.value)},urls.map(u=>h('option',{key:u},u)))),
      content(clicks,'This page has no recorded clicks.',points => {
        const cells = {}
        for (const p of points) {
          const cell = Math.min(9,Math.floor(10*p.x/p.width))+','+Math.min(9,Math.floor(10*p.y/p.height))
          cells[cell] = (cells[cell]||0)+1
        }
        const max = Math.max(...Object.values(cells))
        return h('div',null,h('p',null,points.length+' clicks · Positions relative to the full document'),
          h('p',null,'Darker = more clicks in that spot'),
          h('div',{className:'map',role:'img','aria-label':'Click positions from top left to bottom right'},points.map((p,i) => {
            const cell = Math.min(9,Math.floor(10*p.x/p.width))+','+Math.min(9,Math.floor(10*p.y/p.height))
            const strength = cells[cell]/max
            return h('i',{key:i,style:{left:(100*p.x/p.width)+'%',top:(100*p.y/p.height)+'%',opacity:0.35+0.65*strength,width:(14+10*strength)+'px',height:(14+10*strength)+'px'}})
          })))
      }))))
}
function App() {
  const [view,set] = useState('Sessions')
  const [revision,refresh] = useState(0)
  const [updated,setUpdated] = useState('')
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh(v => v+1)
    }, 10000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => { setUpdated(new Date().toLocaleTimeString()) }, [revision])
  return h(React.Fragment,null,h('p',{className:'eyebrow'},'SITE ANALYTICS'),h('h1',null,'Visitor activity'),
    h('nav',null,...['Sessions','Click map'].map(v=>h('button',{key:v,'aria-pressed':view===v,onClick:()=>set(v)},v)),
      h('button',{className:'refresh',onClick:()=>refresh(v=>v+1)},'Refresh'),
      updated && h('small',null,'Updated '+updated)),
    h(view==='Sessions'?Sessions:Heatmap,{revision}))
}
ReactDOM.createRoot(document.getElementById('app')).render(h(App))
