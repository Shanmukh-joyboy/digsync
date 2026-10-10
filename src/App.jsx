import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from './supabase'

const CENTER = [12.8406, 80.1534]
const COLORS = { planned: '#3b82f6', ongoing: '#f59e0b', stalled: '#ef4444', completed: '#22c55e' }
const KINDS = { delay: 'Delay', poor_quality: 'Poor quality', safety: 'Safety hazard', update: 'Progress update' }
const todayStr = () => new Date().toISOString().slice(0, 10)
const isOverdue = (p) => p.status !== 'completed' && p.end_date < todayStr()
const day = 86400000

function meters(a, b) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Coordination check: another active project within 150 m and within 180 days
function findConflicts(d, projects) {
  if (!d.lat || !d.start_date || !d.end_date) return []
  const s = new Date(d.start_date).getTime() - 180 * day
  const e = new Date(d.end_date).getTime() + 180 * day
  return projects.filter(
    (p) =>
      p.status !== 'completed' &&
      meters(d, p) < 150 &&
      new Date(p.start_date).getTime() <= e &&
      new Date(p.end_date).getTime() >= s
  )
}

function Picker({ active }) {
  useMapEvents({
    click: (e) => { if (active) window.dispatchEvent(new CustomEvent('map-pick', { detail: e.latlng })) },
  })
  return null
}

export default function App() {
  const [projects, setProjects] = useState([])
  const [reports, setReports] = useState([])
  const [selected, setSelected] = useState(null)
  const [filter, setFilter] = useState('all')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [session, setSession] = useState(null)
  const [showLogin, setShowLogin] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [query, setQuery] = useState('')

  async function load() {
    const [p, r] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('reports').select('*').order('created_at', { ascending: false }),
    ])
    if (p.error) return setError(p.error.message)
    setProjects(p.data); setReports(r.data || [])
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    load()
    const ch = supabase
      .channel('live')
      .on('postgres_changes', { event: '*', schema: 'public' }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return projects.filter((p) =>
      (filter === 'all' || (filter === 'overdue' ? isOverdue(p) : p.status === filter)) &&
      (!q || [p.title, p.road, p.department, p.contractor].some((v) => (v || '').toLowerCase().includes(q)))
    )
  }, [projects, filter, query])
  const sel = projects.find((p) => p.id === selected)

  const conflictIds = useMemo(() => {
    const ids = new Set()
    projects.forEach((a) => {
      if (a.status === 'completed') return
      findConflicts(a, projects.filter((b) => b.id !== a.id)).forEach((b) => { ids.add(a.id); ids.add(b.id) })
    })
    return ids
  }, [projects])

  const stats = {
    total: projects.length,
    ongoing: projects.filter((p) => p.status === 'ongoing').length,
    overdue: projects.filter(isOverdue).length,
    reports: reports.length,
  }

  return (
    <div className="app">
      <header>
        <h1>🚧 DigOnce <span>Know what's being built on your street</span></h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="chip" onClick={() => { setShowStats(true); setSelected(null); setAdding(false); setShowLogin(false) }}>Stats</button>
          {session ? (
            <>
              <small>{session.user.email}</small>
              <button className="chip" onClick={() => supabase.auth.signOut()}>Logout</button>
              <button className="primary" onClick={() => { setAdding(true); setSelected(null); setShowLogin(false); setShowStats(false) }}>+ Add project</button>
            </>
          ) : (
            <button className="primary" onClick={() => { setShowLogin(true); setSelected(null); setShowStats(false) }}>Department login</button>
          )}
        </div>
      </header>
      <div className="stats">
        <b>{stats.total}</b> projects · <b>{stats.ongoing}</b> ongoing · <b className="red">{stats.overdue}</b> overdue · <b>{stats.reports}</b> citizen reports
      </div>
      {error && <div className="error">{error}</div>}
      <div className="main">
        <aside>
          <input style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }} placeholder="Search title, road, department…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="filters">
            {['all', 'planned', 'ongoing', 'stalled', 'completed', 'overdue'].map((f) => (
              <button key={f} className={filter === f ? 'chip on' : 'chip'} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
          {adding ? (
            <AddProject projects={projects} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load() }} />
          ) : showStats ? (
            <Stats projects={projects} reports={reports} onBack={() => setShowStats(false)} />
          ) : showLogin && !session ? (
            <Login onDone={() => setShowLogin(false)} onBack={() => setShowLogin(false)} />
          ) : sel ? (
            <Detail canEdit={!!session} project={sel} reports={reports.filter((r) => r.project_id === sel.id)} onBack={() => setSelected(null)} onChange={load} />
          ) : (
            <ul className="list">
              {shown.map((p) => (
                <li key={p.id} onClick={() => setSelected(p.id)}>
                  <span className="dot" style={{ background: COLORS[p.status] }} />
                  <div>
                    <strong>{p.title}</strong>
                    <small>{p.road} · {p.department}</small>
                    <small>{p.status}{isOverdue(p) && <em className="red"> · OVERDUE</em>} · due {p.end_date}</small>
                    {conflictIds.has(p.id) && <small style={{ color: '#7c3aed' }}>⚠ Needs coordination with nearby work</small>}
                  </div>
                </li>
              ))}
              {!shown.length && <p className="muted">No projects match.</p>}
            </ul>
          )}
        </aside>
        <MapContainer center={CENTER} zoom={15} className="map">
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <Picker active={adding} />
          {shown.map((p) => (
            <CircleMarker
              key={p.id}
              center={[p.lat, p.lng]}
              radius={selected === p.id ? 14 : 10}
              pathOptions={{ color: isOverdue(p) ? '#991b1b' : conflictIds.has(p.id) ? '#7c3aed' : '#fff', weight: 3, fillColor: COLORS[p.status], fillOpacity: 0.95 }}
              eventHandlers={{ click: () => { setSelected(p.id); setAdding(false); setShowStats(false) } }}
            />
          ))}
        </MapContainer>
      </div>
    </div>
  )
}

function Detail({ project: p, reports, onBack, onChange, canEdit }) {
  const [form, setForm] = useState({ kind: 'delay', message: '', author: '' })
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!form.message.trim()) return
    setBusy(true)
    const { error } = await supabase.from('reports').insert({ project_id: p.id, ...form })
    if (error) { setBusy(false); alert('Could not submit report: ' + error.message); return }
    setForm({ kind: 'delay', message: '', author: '' }); setBusy(false); onChange()
  }

  async function affected(r) {
    await supabase.from('reports').update({ affected: r.affected + 1 }).eq('id', r.id)
    onChange()
  }

  async function setStatus(status) {
    await supabase.from('projects').update({ status, progress: status === 'completed' ? 100 : p.progress }).eq('id', p.id)
    onChange()
  }

  async function setProgress(v) {
    const n = Math.min(100, Math.max(0, Number(v) || 0))
    await supabase.from('projects').update({ progress: n }).eq('id', p.id)
    onChange()
  }

  return (
    <div className="detail">
      <button className="link" onClick={onBack}>← All projects</button>
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
        <p className="muted">Status: <b>{p.status}</b>. Only department accounts can update it.</p>
      )}

      <h3>Citizen reports</h3>
      <form onSubmit={submit} className="form">
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
          {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <textarea placeholder="What's happening on the ground?" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
        <input placeholder="Your name (optional)" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
        <button className="primary" disabled={busy}>Submit report</button>
      </form>
      <ul className="reports">
        {reports.map((r) => (
          <li key={r.id}>
            <b>{KINDS[r.kind]}</b> <small>{new Date(r.created_at).toLocaleDateString()} · {r.author || 'Anonymous'}</small>
            <p>{r.message}</p>
            <button className="chip" onClick={() => affected(r)}>👍 Affects me too ({r.affected})</button>
          </li>
        ))}
        {!reports.length && <p className="muted">No reports yet.</p>}
      </ul>
    </div>
  )
}

function AddProject({ projects, onClose, onSaved }) {
  const [f, setF] = useState({
    title: '', description: '', department: '', contractor: '', road: '',
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
    const { error } = await supabase.from('projects').insert({ ...f, status: 'planned', progress: 0 })
    if (error) setErr(error.message); else onSaved()
  }

  return (
    <form className="form detail" onSubmit={save}>
      <button type="button" className="link" onClick={onClose}>← Cancel</button>
      <h2>Add a project</h2>
      <p className="muted">Click the map to place it{f.lat && ` ✔ (${f.lat.toFixed(4)}, ${f.lng.toFixed(4)})`}</p>
      <input required placeholder="Project title" value={f.title} onChange={set('title')} />
      <textarea placeholder="What is being done and why?" value={f.description} onChange={set('description')} />
      <input required placeholder="Department" value={f.department} onChange={set('department')} />
      <input placeholder="Contractor" value={f.contractor} onChange={set('contractor')} />
      <input required placeholder="Road / area" value={f.road} onChange={set('road')} />
      <label>Start <input type="date" required value={f.start_date} onChange={set('start_date')} /></label>
      <label>End <input type="date" required value={f.end_date} onChange={set('end_date')} /></label>
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
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setErr(error.message); else onDone()
  }

  return (
    <form className="form detail" onSubmit={submit}>
      <button type="button" className="link" onClick={onBack}>← Back</button>
      <h2>Department login</h2>
      <p className="muted">Only authorised departments can add or update projects. Citizens can browse and report without logging in.</p>
      <input type="email" required placeholder="Department email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input type="password" required placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {err && <div className="error">{err}</div>}
      <button className="primary">Log in</button>
    </form>
  )
}

function Bar({ label, value, max }) {
  return (
    <div style={{ margin: '6px 0' }}>
      <small>{label} ({value})</small>
      <div style={{ background: '#e5e7eb', borderRadius: 4, height: 10 }}>
        <div style={{ width: `${max ? (value / max) * 100 : 0}%`, background: '#2563eb', height: 10, borderRadius: 4 }} />
      </div>
    </div>
  )
}

function Stats({ projects, reports, onBack }) {
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

  // Coordination conflicts: same rule as the Add-project alert, each pair counted once
  const conflicts = []
  projects.forEach((a) => {
    if (a.status === 'completed') return
    findConflicts(a, projects.filter((b) => b.id !== a.id)).forEach((b) => {
      if (String(a.id) < String(b.id)) conflicts.push([a, b])
    })
  })

  return (
    <div className="detail">
      <button type="button" className="link" onClick={onBack}>← Back</button>
      <h2>City stats</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '12px 0' }}>
        <div><b style={{ fontSize: 24 }}>{projects.length}</b><br /><small>Projects</small></div>
        <div><b style={{ fontSize: 24 }}>{overdue.length}</b><br /><small>Overdue</small></div>
        <div><b style={{ fontSize: 24 }}>{avg}%</b><br /><small>Avg progress</small></div>
        <div><b style={{ fontSize: 24 }}>{conflicts.length}</b><br /><small>Coordination conflicts</small></div>
      </div>

      <h3>Conflicts to coordinate</h3>
      {conflicts.length === 0 && <p className="muted">No overlapping work found.</p>}
      {conflicts.map(([a, b]) => (
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