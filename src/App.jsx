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

  async function load() {
    const [p, r] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('reports').select('*').order('created_at', { ascending: false }),
    ])
    if (p.error) return setError(p.error.message)
    setProjects(p.data); setReports(r.data || [])
  }
  useEffect(() => {
    load()
    const ch = supabase
      .channel('live')
      .on('postgres_changes', { event: '*', schema: 'public' }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  const shown = useMemo(() => projects.filter((p) => filter === 'all' || (filter === 'overdue' ? isOverdue(p) : p.status === filter)), [projects, filter])
  const sel = projects.find((p) => p.id === selected)
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
        <button className="primary" onClick={() => { setAdding(true); setSelected(null) }}>+ Add project</button>
      </header>
      <div className="stats">
        <b>{stats.total}</b> projects · <b>{stats.ongoing}</b> ongoing · <b className="red">{stats.overdue}</b> overdue · <b>{stats.reports}</b> citizen reports
      </div>
      {error && <div className="error">{error}</div>}
      <div className="main">
        <aside>
          <div className="filters">
            {['all', 'planned', 'ongoing', 'stalled', 'completed', 'overdue'].map((f) => (
              <button key={f} className={filter === f ? 'chip on' : 'chip'} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
          {adding ? (
            <AddProject projects={projects} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load() }} />
          ) : sel ? (
            <Detail project={sel} reports={reports.filter((r) => r.project_id === sel.id)} onBack={() => setSelected(null)} onChange={load} />
          ) : (
            <ul className="list">
              {shown.map((p) => (
                <li key={p.id} onClick={() => setSelected(p.id)}>
                  <span className="dot" style={{ background: COLORS[p.status] }} />
                  <div>
                    <strong>{p.title}</strong>
                    <small>{p.road} · {p.department}</small>
                    <small>{p.status}{isOverdue(p) && <em className="red"> · OVERDUE</em>} · due {p.end_date}</small>
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
              pathOptions={{ color: isOverdue(p) ? '#991b1b' : '#fff', weight: 3, fillColor: COLORS[p.status], fillOpacity: 0.95 }}
              eventHandlers={{ click: () => { setSelected(p.id); setAdding(false) } }}
            />
          ))}
        </MapContainer>
      </div>
    </div>
  )
}

function Detail({ project: p, reports, onBack, onChange }) {
  const [form, setForm] = useState({ kind: 'delay', message: '', author: '' })
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!form.message.trim()) return
    setBusy(true)
    await supabase.from('reports').insert({ project_id: p.id, ...form })
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
      <div className="filters">
        <small>Status:</small>
        {Object.keys(COLORS).map((s) => (
          <button key={s} className={p.status === s ? 'chip on' : 'chip'} onClick={() => setStatus(s)}>{s}</button>
        ))}
      </div>

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