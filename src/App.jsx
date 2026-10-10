import { Component, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from './supabase'
import { conflictPairs, findConflicts } from './lib/geo'

const CENTER = [12.9300, 80.1400]
const COLORS = { planned: '#3b82f6', ongoing: '#f59e0b', stalled: '#ef4444', completed: '#22c55e' }
const KINDS = { delay: 'Delay', poor_quality: 'Poor quality', safety: 'Safety hazard', update: 'Progress update' }

// Local date (not UTC), so "today" is correct in India just after midnight
const todayStr = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
const isOverdue = (p) => p.status !== 'completed' && p.end_date < todayStr()
const hasCoords = (p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))

// A render error should never leave the user with a blank white page
class ErrorBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e) { console.error(e) }
  render() {
    return this.state.failed ? (
      <div className="error" style={{ margin: 16 }}>
        Something went wrong. <button onClick={() => window.location.reload()}>Reload the page</button>
      </div>
    ) : this.props.children
  }
}

function Picker({ active }) {
  useMapEvents({
    click: (e) => { if (active) window.dispatchEvent(new CustomEvent('map-pick', { detail: e.latlng })) },
  })
  return null
}

function FlyTo({ target }) {
  const map = useMap()
  useEffect(() => {
    if (target && hasCoords(target)) {
      map.flyTo([Number(target.lat), Number(target.lng)], Math.max(map.getZoom(), 14), { duration: 0.8 })
    }
  }, [target?.id])
  return null
}

const dot = (bg) => ({ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: bg, marginRight: 6 })
const ring = (c) => ({ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', border: `3px solid ${c}`, marginRight: 6 })

function Legend() {
  return (
    <div style={{ position: 'absolute', bottom: 16, left: 10, zIndex: 1000, background: 'rgba(255,255,255,0.95)', color: '#111', padding: '8px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1.6, maxWidth: 230, boxShadow: '0 1px 4px rgba(0,0,0,.3)', pointerEvents: 'none' }}>
      <b>Legend</b>
      {Object.entries(COLORS).map(([s, c]) => <div key={s}><span style={dot(c)} />{s}</div>)}
      <div><span style={ring('#991b1b')} />overdue</div>
      <div><span style={ring('#7c3aed')} />needs coordination</div>
      <div style={{ marginTop: 4, opacity: 0.7 }}>Data: public reports, Oct 2026. Dates and locations are indicative.</div>
    </div>
  )
}

function AppInner() {
  const [projects, setProjects] = useState([])
  const [reports, setReports] = useState([])
  const [votes, setVotes] = useState([])
  const [replies, setReplies] = useState([])
  const [selected, setSelected] = useState(null)
  const [filter, setFilter] = useState('all')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [online, setOnline] = useState(navigator.onLine)
  const [session, setSession] = useState(null)
  const [showLogin, setShowLogin] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [query, setQuery] = useState('')
  const hashDone = useRef(false)

  async function load() {
    try {
      const [p, r, v, rp] = await Promise.all([
        supabase.from('projects').select('*').order('created_at', { ascending: false }),
        supabase.from('reports').select('*').order('created_at', { ascending: false }),
        supabase.from('report_votes').select('*'),
        supabase.from('report_replies').select('*').order('created_at', { ascending: true }),
      ])
      if (p.error) return setError('Could not load projects: ' + p.error.message)
      setError(r.error ? 'Could not load reports: ' + r.error.message : '')
      setProjects(p.data); setReports(r.data || []); setVotes(v.data || []); setReplies(rp.data || [])
    } catch (e) {
      setError('Network problem. Check your connection and refresh.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  // Realtime: a burst of changes triggers one reload, not one per change
  useEffect(() => {
    load()
    let timer
    const refresh = () => { clearTimeout(timer); timer = setTimeout(load, 400) }
    const ch = supabase.channel('live').on('postgres_changes', { event: '*', schema: 'public' }, refresh).subscribe()
    return () => { clearTimeout(timer); supabase.removeChannel(ch) }
  }, [])

  useEffect(() => {
    const on = () => { setOnline(true); load() }
    const off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // Shareable links: #project=<id> opens that project
  useEffect(() => {
    if (hashDone.current || !projects.length) return
    hashDone.current = true
    const m = window.location.hash.match(/project=([^&]+)/)
    if (m) {
      const p = projects.find((x) => String(x.id) === decodeURIComponent(m[1]))
      if (p) setSelected(p.id)
    }
  }, [projects])

  useEffect(() => {
    if (!hashDone.current) return
    window.history.replaceState(null, '', selected ? '#project=' + selected : window.location.pathname + window.location.search)
  }, [selected])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return projects.filter((p) =>
      (filter === 'all' || (filter === 'overdue' ? isOverdue(p) : p.status === filter)) &&
      (!q || [p.title, p.road, p.department, p.contractor].some((v) => (v || '').toLowerCase().includes(q)))
    )
  }, [projects, filter, query])
  const mappable = shown.filter(hasCoords)
  const sel = projects.find((p) => p.id === selected)
  const myDept = session?.user?.app_metadata?.department || ''
  const userId = session?.user?.id || null
  const displayName = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || ''

  const pairs = useMemo(() => conflictPairs(projects), [projects])
  const conflictIds = useMemo(() => {
    const ids = new Set()
    pairs.forEach(([a, b]) => { ids.add(a.id); ids.add(b.id) })
    return ids
  }, [pairs])

  const stats = {
    total: projects.length,
    ongoing: projects.filter((p) => p.status === 'ongoing').length,
    overdue: projects.filter(isOverdue).length,
    reports: reports.length,
  }

  return (
    <div className="app">
      <header>
        <h1>🚧 DigSync <span>Know what's being built on your street</span></h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="chip" onClick={() => { setShowStats(true); setSelected(null); setAdding(false); setShowLogin(false) }}>Stats</button>
          {session ? (
            <>
              <small>{displayName} · {myDept || 'Citizen'}</small>
              <button className="chip" onClick={() => supabase.auth.signOut()}>Logout</button>
              {myDept && <button className="primary" onClick={() => { setAdding(true); setSelected(null); setShowLogin(false); setShowStats(false) }}>+ Add project</button>}
            </>
          ) : (
            <button className="primary" onClick={() => { setShowLogin(true); setShowStats(false); setAdding(false) }}>Log in / Sign up</button>
          )}
        </div>
      </header>
      <div className="stats">
        <b>{stats.total}</b> projects · <b>{stats.ongoing}</b> ongoing · <b className="red">{stats.overdue}</b> overdue · <b>{stats.reports}</b> citizen reports
      </div>
      {!online && <div className="error">You are offline. Showing the last loaded data, and changes can't be saved.</div>}
      {error && <div className="error">{error}</div>}
      <div className="main">
        <aside>
          <input aria-label="Search projects" style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }} placeholder="Search title, road, department…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="filters">
            {['all', 'planned', 'ongoing', 'stalled', 'completed', 'overdue'].map((f) => (
              <button key={f} className={filter === f ? 'chip on' : 'chip'} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
          {adding ? (
            <AddProject projects={projects} dept={myDept} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load() }} />
          ) : showStats ? (
            <Stats projects={projects} reports={reports} replies={replies} pairs={pairs} onBack={() => setShowStats(false)} />
          ) : showLogin && !session ? (
            <Login onDone={() => setShowLogin(false)} onBack={() => setShowLogin(false)} />
          ) : sel ? (
            <Detail
              canEdit={!!session && !!myDept && sel.department === myDept}
              project={sel}
              reports={reports.filter((r) => r.project_id === sel.id)}
              replies={replies}
              votes={votes}
              userId={userId}
              displayName={displayName}
              onNeedLogin={() => setShowLogin(true)}
              onBack={() => setSelected(null)}
              onChange={load}
            />
          ) : (
            <ul className="list">
              {shown.map((p) => (
                <li key={p.id} tabIndex={0} role="button" onClick={() => setSelected(p.id)} onKeyDown={(e) => { if (e.key === 'Enter') setSelected(p.id) }}>
                  <span className="dot" style={{ background: COLORS[p.status] }} />
                  <div>
                    <strong>{p.title}</strong>
                    <small>{p.road} · {p.department}</small>
                    <small>{p.status}{isOverdue(p) && <em className="red"> · OVERDUE</em>} · due {p.end_date}</small>
                    {conflictIds.has(p.id) && <small style={{ color: '#7c3aed' }}>⚠ Needs coordination with nearby work</small>}
                  </div>
                </li>
              ))}
              {loading && <p className="muted">Loading projects…</p>}
              {!loading && !shown.length && <p className="muted">No projects match.</p>}
            </ul>
          )}
        </aside>
        <MapContainer center={CENTER} zoom={11} className="map">
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <Picker active={adding} />
          <FlyTo target={sel} />
          {mappable.map((p) => (
            <CircleMarker
              key={p.id}
              center={[Number(p.lat), Number(p.lng)]}
              radius={selected === p.id ? 14 : 10}
              pathOptions={{ color: isOverdue(p) ? '#991b1b' : conflictIds.has(p.id) ? '#7c3aed' : '#fff', weight: 3, fillColor: COLORS[p.status], fillOpacity: 0.95 }}
              eventHandlers={{ click: () => { setSelected(p.id); setAdding(false); setShowStats(false) } }}
            >
              <Tooltip>{p.title}</Tooltip>
            </CircleMarker>
          ))}
          <Legend />
        </MapContainer>
      </div>
    </div>
  )
}

export default function App() {
  return <ErrorBoundary><AppInner /></ErrorBoundary>
}

function ReplyBox({ report, project, onDone }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  async function send(e) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    const { error } = await supabase.from('report_replies').insert({
      report_id: String(report.id), project_id: String(project.id), department: project.department, message: text.trim(),
    })
    setBusy(false)
    if (error) return alert('Could not post reply: ' + error.message)
    setText(''); onDone()
  }

  return (
    <form onSubmit={send} className="form">
      <input maxLength={500} placeholder={`Official reply from ${project.department}…`} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="chip" disabled={busy}>Post reply</button>
    </form>
  )
}

function Detail({ project: p, reports, replies, votes, userId, displayName, onNeedLogin, onBack, onChange, canEdit }) {
  const [form, setForm] = useState({ kind: 'delay', message: '' })
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState([])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    supabase.from('project_audit').select('*').eq('project_id', String(p.id))
      .order('changed_at', { ascending: false }).limit(5)
      .then(({ data }) => setHistory(data || []))
  }, [p.id, p.status, p.progress])

  async function copyLink() {
    const url = window.location.origin + window.location.pathname + '#project=' + p.id
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy this link:', url)
    }
  }

  async function submit(e) {
    e.preventDefault()
    if (!form.message.trim()) return
    setBusy(true)
    const { error } = await supabase.from('reports').insert({ project_id: p.id, kind: form.kind, message: form.message, author: displayName })
    if (error) { setBusy(false); alert('Could not submit report: ' + error.message); return }
    setForm({ kind: 'delay', message: '' }); setBusy(false); onChange()
  }

  const countFor = (r) => votes.filter((v) => String(v.report_id) === String(r.id)).length
  const votedBy = (r) => votes.some((v) => String(v.report_id) === String(r.id) && v.user_id === userId)

  async function toggleVote(r) {
    if (!userId) return onNeedLogin()
    const { error } = votedBy(r)
      ? await supabase.from('report_votes').delete().eq('report_id', String(r.id)).eq('user_id', userId)
      : await supabase.from('report_votes').insert({ report_id: String(r.id), user_id: userId })
    if (error) alert('Could not save: ' + error.message)
    onChange()
  }

  // .select() matters: a write blocked by row-level security returns no error, just zero rows
  async function updateProject(patch) {
    const { data, error } = await supabase.from('projects').update(patch).eq('id', p.id).select()
    if (error || !data?.length) {
      alert('Update not saved' + (error ? ': ' + error.message : '. You may not have permission for this project.'))
      return
    }
    onChange()
  }
  const setStatus = (status) => updateProject({ status, progress: status === 'completed' ? 100 : p.progress })
  const setProgress = (v) => updateProject({ progress: Math.min(100, Math.max(0, Number(v) || 0)) })

  return (
    <div className="detail">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button className="link" onClick={onBack}>← All projects</button>
        <button className="chip" onClick={copyLink}>{copied ? 'Link copied ✔' : '🔗 Share link'}</button>
      </div>
      <h2>{p.title}</h2>
      {isOverdue(p) && <div className="warn">⚠ Deadline passed on {p.end_date}. {reports.length} citizen report(s) filed.</div>}
      <p>{p.description}</p>
      <dl>
        <dt>Department</dt><dd>{p.department}</dd>
        <dt>Contractor</dt><dd>{p.contractor || '—'}</dd>
        <dt>Location</dt><dd>{p.road}</dd>
        <dt>Timeline</dt><dd>{p.start_date} → {p.end_date}</dd>
      </dl>
      <div className="bar"><div style={{ width: p.progress + '%', background: COLORS[p.status] }} /></div>
      <small>{p.progress}% complete</small>

      {history.length > 0 && (
        <>
          <h3>Update history</h3>
          <ul className="reports">
            {history.map((h) => (
              <li key={h.id}>
                <small>{new Date(h.changed_at).toLocaleString()} · {h.department}</small>
                <p>{h.old_status} → {h.new_status} · {h.old_progress}% → {h.new_progress}%</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {canEdit ? (
        <>
          <div className="filters">
            <small>Status:</small>
            {Object.keys(COLORS).map((s) => (
              <button key={s} className={p.status === s ? 'chip on' : 'chip'} onClick={() => setStatus(s)}>{s}</button>
            ))}
          </div>
          <label>Progress %
            <input type="number" min="0" max="100" defaultValue={p.progress}
              key={p.id + '-' + p.progress} onBlur={(e) => setProgress(e.target.value)} />
          </label>
        </>
      ) : (
        <p className="muted">Status: <b>{p.status}</b>. Only {p.department} can update this project.</p>
      )}

      <h3>Citizen reports</h3>
      {userId ? (
        <form onSubmit={submit} className="form">
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <textarea maxLength={1000} placeholder="What's happening on the ground?" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          <small className="muted">Posting as {displayName}</small>
          <button className="primary" disabled={busy}>Submit report</button>
        </form>
      ) : (
        <p className="muted">
          <button className="link" onClick={onNeedLogin}>Log in or sign up</button> as a citizen to file a report or confirm one.
        </p>
      )}
      <ul className="reports">
        {reports.map((r) => (
          <li key={r.id}>
            <b>{KINDS[r.kind]}</b> <small>{new Date(r.created_at).toLocaleDateString()} · {r.author || 'Anonymous'}</small>
            <p>{r.message}</p>
            <button className={votedBy(r) ? 'chip on' : 'chip'} onClick={() => toggleVote(r)}>👍 Affects me too ({countFor(r)})</button>
            {replies.filter((x) => String(x.report_id) === String(r.id)).map((x) => (
              <p key={x.id} style={{ background: '#eff6ff', color: '#111', borderLeft: '3px solid #2563eb', padding: '6px 8px', margin: '6px 0' }}>
                <b>Official reply · {x.department}</b> <small>{new Date(x.created_at).toLocaleDateString()}</small><br />
                {x.message}
              </p>
            ))}
            {canEdit && <ReplyBox report={r} project={p} onDone={onChange} />}
          </li>
        ))}
        {!reports.length && <p className="muted">No reports yet.</p>}
      </ul>
    </div>
  )
}

function AddProject({ projects, dept, onClose, onSaved }) {
  const [f, setF] = useState({
    title: '', description: '', department: dept, contractor: '', road: '',
    start_date: todayStr(), end_date: '', lat: null, lng: null,
  })
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const conflicts = findConflicts(f, projects)

  useEffect(() => {
    const handler = (e) => setF((s) => ({ ...s, lat: e.detail.lat, lng: e.detail.lng }))
    window.addEventListener('map-pick', handler)
    return () => window.removeEventListener('map-pick', handler)
  }, [])

  async function save(e) {
    e.preventDefault()
    if (!f.lat) return setErr('Click on the map to set the location.')
    if (f.end_date < f.start_date) return setErr('End date must be on or after the start date.')
    const { error } = await supabase.from('projects').insert({ ...f, department: dept, status: 'planned', progress: 0 })
    if (error) setErr(error.message); else onSaved()
  }

  return (
    <form className="form detail" onSubmit={save}>
      <button type="button" className="link" onClick={onClose}>← Cancel</button>
      <h2>Add a project</h2>
      <p className="muted">Click the map to place it{f.lat && ` ✔ (${f.lat.toFixed(4)}, ${f.lng.toFixed(4)})`}</p>
      <input required placeholder="Project title" value={f.title} onChange={set('title')} />
      <textarea placeholder="What is being done and why?" value={f.description} onChange={set('description')} />
      <input required value={f.department} readOnly title="Your department" />
      <input placeholder="Contractor" value={f.contractor} onChange={set('contractor')} />
      <input required placeholder="Road / area" value={f.road} onChange={set('road')} />
      <label>Start <input type="date" required value={f.start_date} onChange={set('start_date')} /></label>
      <label>End <input type="date" required min={f.start_date} value={f.end_date} onChange={set('end_date')} /></label>
      {conflicts.length > 0 && (
        <div className="warn">
          ⚠ <b>Coordination alert:</b> {conflicts.length} other project(s) within 150 m around the same time:
          <ul>{conflicts.map((c) => <li key={c.id}>{c.title} ({c.department}, {c.start_date} → {c.end_date})</li>)}</ul>
          Consider scheduling together so the road is dug up only once.
        </div>
      )}
      {err && <div className="error">{err}</div>}
      <button className="primary">Save project</button>
    </form>
  )
}

function Login({ onDone, onBack }) {
  const [role, setRole] = useState('citizen')
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const signup = role === 'citizen' && mode === 'signup'

  async function submit(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    const res = signup
      ? await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } })
      : await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (res.error) return setErr(res.error.message)
    if (role === 'department' && !res.data.user?.app_metadata?.department) {
      await supabase.auth.signOut()
      return setErr('This account is not a department account.')
    }
    if (signup && !res.data.session) return setErr('Account created. Check your email to confirm, then log in.')
    onDone()
  }

  return (
    <form className="form detail" onSubmit={submit}>
      <button type="button" className="link" onClick={onBack}>← Back</button>
      <h2>{signup ? 'Create citizen account' : 'Log in'}</h2>
      <div className="filters">
        <button type="button" className={role === 'citizen' ? 'chip on' : 'chip'} onClick={() => { setRole('citizen'); setErr('') }}>Citizen</button>
        <button type="button" className={role === 'department' ? 'chip on' : 'chip'} onClick={() => { setRole('department'); setMode('login'); setErr('') }}>Department</button>
      </div>
      <p className="muted">
        {role === 'citizen'
          ? 'Citizens can file reports and confirm others. Everyone can browse without an account.'
          : 'Department accounts are issued by the administrator. Each can add and update only its own projects.'}
      </p>
      {signup && <input required placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />}
      <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input type="password" required minLength={6} placeholder="Password (min 6 characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
      {err && <div className="error">{err}</div>}
      <button className="primary" disabled={busy}>{signup ? 'Sign up' : 'Log in'}</button>
      {role === 'citizen' && (
        <button type="button" className="link" onClick={() => { setMode(signup ? 'login' : 'signup'); setErr('') }}>
          {signup ? 'Already have an account? Log in' : 'New here? Create a citizen account'}
        </button>
      )}
    </form>
  )
}

function Bar({ label, value, max, plain }) {
  return (
    <div style={{ margin: '6px 0' }}>
      <small>{label}{plain ? '' : ` (${value})`}</small>
      <div style={{ background: '#e5e7eb', borderRadius: 4, height: 10 }}>
        <div style={{ width: `${max ? (value / max) * 100 : 0}%`, background: '#2563eb', height: 10, borderRadius: 4 }} />
      </div>
    </div>
  )
}

// Open data: anyone can download the project list. Text cells starting with = + - @ are
// prefixed so a spreadsheet never runs them as formulas.
function downloadCsv(projects) {
  const cols = ['title', 'department', 'contractor', 'road', 'status', 'progress', 'start_date', 'end_date', 'lat', 'lng']
  const esc = (v) => {
    let s = String(v ?? '')
    if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = "'" + s
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const csv = [cols.join(','), ...projects.map((p) => cols.map((c) => esc(p[c])).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url; a.download = 'digsync-projects.csv'; a.click()
  URL.revokeObjectURL(url)
}

function Stats({ projects, reports, replies, pairs, onBack }) {
  const overdue = projects.filter(isOverdue)

  const byDept = {}
  overdue.forEach((p) => { byDept[p.department || 'Unassigned'] = (byDept[p.department || 'Unassigned'] || 0) + 1 })

  const counts = {}
  reports.forEach((r) => { counts[r.project_id] = (counts[r.project_id] || 0) + 1 })
  const topReported = projects
    .map((p) => ({ p, n: counts[p.id] || 0 }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 5)

  const avg = projects.length
    ? Math.round(projects.reduce((s, p) => s + (Number(p.progress) || 0), 0) / projects.length)
    : 0

  const byStatus = {}
  projects.forEach((p) => { byStatus[p.status] = (byStatus[p.status] || 0) + 1 })
  const byKind = {}
  reports.forEach((r) => { byKind[r.kind] = (byKind[r.kind] || 0) + 1 })

  // Department responsiveness: share of citizen reports that received an official reply
  const deptOf = {}
  projects.forEach((p) => { deptOf[p.id] = p.department })
  const repliedIds = new Set(replies.map((x) => String(x.report_id)))
  const resp = {}
  reports.forEach((r) => {
    const d = deptOf[r.project_id] || 'Unassigned'
    resp[d] = resp[d] || { total: 0, replied: 0 }
    resp[d].total++
    if (repliedIds.has(String(r.id))) resp[d].replied++
  })

  return (
    <div className="detail">
      <button type="button" className="link" onClick={onBack}>← Back</button>
      <h2>City stats</h2>
      <button className="chip" onClick={() => downloadCsv(projects)}>⬇ Download projects (CSV)</button>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '12px 0' }}>
        <div><b style={{ fontSize: 24 }}>{projects.length}</b><br /><small>Projects</small></div>
        <div><b style={{ fontSize: 24 }}>{overdue.length}</b><br /><small>Overdue</small></div>
        <div><b style={{ fontSize: 24 }}>{avg}%</b><br /><small>Avg progress</small></div>
        <div><b style={{ fontSize: 24 }}>{pairs.length}</b><br /><small>Coordination conflicts</small></div>
      </div>

      <h3>Conflicts to coordinate</h3>
      {pairs.length === 0 && <p className="muted">No overlapping work found.</p>}
      {pairs.map(([a, b]) => (
        <p key={a.id + '-' + b.id} style={{ margin: '6px 0' }}>
          <b>{a.title}</b> ({a.department}) and <b>{b.title}</b> ({b.department}) are within 150 m with overlapping dates.
        </p>
      ))}

      <h3>Projects by status</h3>
      {Object.entries(byStatus).map(([s, n]) => (
        <Bar key={s} label={s} value={n} max={projects.length} />
      ))}

      <h3>Overdue by department</h3>
      {Object.keys(byDept).length === 0 && <p className="muted">No overdue projects.</p>}
      {Object.entries(byDept).map(([d, n]) => (
        <Bar key={d} label={d} value={n} max={Math.max(...Object.values(byDept))} />
      ))}

      <h3>Department responsiveness</h3>
      {Object.keys(resp).length === 0 && <p className="muted">No citizen reports yet.</p>}
      {Object.entries(resp).map(([d, v]) => (
        <Bar key={d} plain label={`${d}: ${v.replied} of ${v.total} reports answered`} value={v.replied} max={v.total} />
      ))}

      <h3>Most-reported projects</h3>
      {topReported.length === 0 && <p className="muted">No citizen reports yet.</p>}
      {topReported.map(({ p, n }) => (
        <Bar key={p.id} label={p.title} value={n} max={topReported[0].n} />
      ))}

      <h3>Citizen reports by type</h3>
      {Object.keys(byKind).length === 0 && <p className="muted">No citizen reports yet.</p>}
      {Object.entries(byKind).map(([k, n]) => (
        <Bar key={k} label={KINDS[k] || k} value={n} max={Math.max(...Object.values(byKind))} />
      ))}
    </div>
  )
}