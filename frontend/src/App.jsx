import { Component, Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import MeshViewer, { Thumb, meshStats, fm } from './MeshViewer.jsx'
import { generate, vote as sendVote, fileUrl, health, cancelJob, simulatePhysics, fetchHistory } from './api.js'
import ShapeEditor from './ShapeEditor.jsx'

/* ---------- static data ---------- */
const NAV = [
  ['chat', 'Chat', 'chat'],
  ['hist', 'History', 'clock'],
  ['files', 'Generated files', 'cube'],
  ['pricing', 'Pricing', 'tag']
]
const SUB = [
  ['general', 'General'],
  ['appearance', 'Appearance'],
  ['model', 'Model defaults'],
  ['notif', 'Notifications'],
  ['data', 'Data controls'],
  ['account', 'Account']
]
const ACCENTS = ['#38bdf8', '#3b82f6', '#10b981', '#f59e0b']
const CHIPS = [
  ['SPORTS CAR', 'Build a GT sports car with a sculpted aerodynamic body shell, translucent glass windshield canopy, 4 rubber wheels with alloy rims, and a rear spoiler'],
  ['ROCKET', 'Build a multi-stage sounding rocket with nose cone, fuselage, boat-tail nozzle, and 4 swept fins'],
  ['BRACKET', 'L-bracket 60 mm wide, 40 mm base, 40 mm tall, 5 mm thick, two 6 mm mounting holes in the base'],
  ['GEAR', 'Create a 24-tooth spur gear, module 2, 10 mm bore, 8 mm thick'],
  ['ENCLOSURE', 'Electronics enclosure 80 x 50 x 30 mm, 2 mm walls, open top, USB cutout on one side'],
  ['FLANGE', 'Pipe flange 100 mm diameter, 10 mm thick, 40 mm bore, 4 bolt holes of 6 mm on a 70 mm circle']
]
const MATS = ['Al 6061', 'Steel', 'Titanium', 'Carbon Fiber', 'Brass', 'Copper', 'Glass', 'Rubber', 'PLA', 'ABS']
const FMTS = ['STEP', 'STL']
const P = {
  copy: 'M9 9h11v11H9zM5 15V4h11',
  spk: 'M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  tu: 'M7 11v9H3v-9zM7 11l4-7c2 0 3 1 2.5 3L13 10h6l-1.5 10H7',
  td: 'M7 13V4H3v9zM7 13l4 7c2 0 3-1 2.5-3L13 14h6L17.5 4H7',
  redo: 'M20 5v5h-5M19 10a8 8 0 1 0 1 6',
  pen: 'M4 20l1-4L16 5l3 3L8 19zM14 7l3 3',
  ok: 'M5 12l5 5 9-10',
  l: 'M15 5l-7 7 7 7',
  r: 'M9 5l7 7-7 7',
  x: 'M6 6l12 12M18 6L6 18',
  stop: 'M7 7h10v10H7z'
}

/* ---------- helpers ---------- */
const fname = t => String(t || 'part').split(' ').slice(0, 3).join('_').toLowerCase().replace(/[^a-z0-9_]/g, '') || 'part'

function dl(job, ext) {
  const a = document.createElement('a')
  a.href = fileUrl(job, String(ext).toLowerCase())
  a.target = '_blank'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

const fmtMass = g => (g >= 1000 ? (g / 1000).toFixed(2) + ' kg' : Number(g || 0).toFixed(1) + ' g')
const fmtSize = b => (Array.isArray(b) ? b : [0, 0, 0]).map(x => Math.round(Number(x || 0) * 10) / 10).join(' × ') + ' mm'

function toVersion(r, prompt, f, m) {
  const safePrompt = String(prompt || 'CAD Design')
  return {
    job: r.job,
    n: fname(safePrompt),
    title: (r.plan && r.plan.object) || safePrompt.slice(0, 40),
    f: f || 'STEP',
    m: m || 'Al 6061',
    mass_g: r.mass_g || 0,
    bbox: r.bbox || [0, 0, 0],
    mesh: r.mesh,
    code: r.code || '',
    warning: r.warning || '',
    verified: !!r.verified,
    cached: !!r.cached,
    vol: r.volume_mm3 || null,
    area: r.area_mm2 || null,
    com: r.com || null,
    counts: r.counts || null,
    bmin: r.bbox_min || null,
    density: r.density_g_cm3 || null,
    shape: (r.plan && r.plan.profile_spec) || null,
    checkNote: r.check_detail || '',
    physics: r.physics || null,
  }
}
const plain = v => `Generated ${v.title} in ${v.m}. Size ${fmtSize(v.bbox)}, mass ${fmtMass(v.mass_g)}, ${v.verified ? 'verified' : 'needs checking'}.`

const friendly = m => {
  const s = String(m || '')
  if (/failed to fetch|networkerror|load failed/i.test(s)) return "Can't reach the Brepline server. Make sure the backend is running."
  if (/connection error|llm call failed|LLM_API_KEY/i.test(s)) return "The AI model isn't responding. Check that the model server is running, then try again."
  if (/rate limit|429/i.test(s)) return 'Too many requests. Wait a moment and try again.'
  if (/access code|401/i.test(s)) return 'The access code was rejected. Check VITE_ACCESS_CODE.'
  return s || 'Something went wrong.'
}

const readLS = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const writeLS = (k, v) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }

/* ---------- small components ---------- */
const Ic = ({ n }) => <svg className="i"><use href={`#${n}`} /></svg>
const PI = ({ k }) => <svg className="i" viewBox="0 0 24 24"><path d={P[k]} /></svg>
const PartIcon = () => <svg viewBox="0 0 100 100"><use href="#part" /></svg>

const STAGE_TITLE = ['Planning the design', 'Decomposing & querying cache', 'Building sub-components', 'Assembling & auditing physics']

function stageOf(logs) {
  const last = (logs && logs.length ? logs[logs.length - 1] : '') || ''
  if (/done|safety factor/i.test(last)) return 3
  if (/verified|building component|adapted|repairing/i.test(last)) return 2
  if (/decomposed|generating/i.test(last)) return 1
  return 0
}
const dur = n => (n >= 60 ? `${Math.floor(n / 60)}m ${n % 60}s` : `${n}s`)

function useElapsed(active, t0) {
  const [sec, setSec] = useState(0)
  useEffect(() => {
    if (!active) return
    const tick = () => setSec(Math.max(0, Math.round((Date.now() - (t0 || Date.now())) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [active, t0])
  return sec
}

function Thinking({ state, logs, t0, secs, onStop, partialMesh }) {
  const busy = state === 'busy'
  const [open, setOpen] = useState(busy)
  const live = useElapsed(busy, t0)
  const listRef = useRef(null)
  const lines = logs || []
  useEffect(() => { if (busy) setOpen(true) }, [busy])
  useEffect(() => {
    const el = listRef.current
    if (el && busy) el.scrollTop = el.scrollHeight
  }, [lines.length, busy, open])
  if (!busy && !lines.length) return null
  const head = busy
    ? (lines.length ? STAGE_TITLE[stageOf(lines)] : 'Starting') + '…'
    : state === 'done' ? `Thought for ${dur(secs || 0)}`
    : state === 'stopped' ? `Stopped after ${dur(secs || 0)}`
    : `Failed after ${dur(secs || 0)}`

  const verifiedLine = [...lines].reverse().find(l => /^verified /i.test(l)) || 'Latest compiled sub-part'

  return (
    <div className={'think ' + state}>
      <div className="th-h">
        <button className="th-t" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <svg className="i th-c" viewBox="0 0 24 24" style={{ transform: open ? 'rotate(90deg)' : 'none' }}><path d="M9 5l7 7-7 7" /></svg>
          <span>{head}</span>
          {busy && <span className="th-s">{dur(live)}</span>}
        </button>
        {busy && onStop && <button className="btn th-x" onClick={onStop}><PI k="stop" />Stop</button>}
      </div>
      {open && (
        <ol className="th-l" ref={listRef}>
          {lines.length
            ? lines.map((l, i) => <li key={i} className={busy && i === lines.length - 1 ? 'cur' : ''}>{l}</li>)
            : <li className="cur">Waiting for the engine…</li>}
        </ol>
      )}
      {busy && open && partialMesh && partialMesh.verts && partialMesh.verts.length > 0 && (
        <div style={{ marginTop: 10, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)', maxWidth: 320, background: 'rgba(0,0,0,0.18)' }}>
          <div style={{ fontSize: 11, padding: '5px 10px', opacity: 0.9, borderBottom: '1px solid var(--line)' }}>
            ✓ {verifiedLine}
          </div>
          <div style={{ width: '100%', height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Thumb mesh={partialMesh} alt="Sub-part preview" />
          </div>
        </div>
      )}
      {busy && open && live > 45 && <div className="th-n">Complex multi-part assemblies compile component by component.</div>}
    </div>
  )
}

function SidebarGen({ items, onStop, onOpen }) {
  const it = items[0]
  const sec = useElapsed(!!it, it && it.t0)
  if (!it) return null
  const has = it.logs && it.logs.length
  return (
    <div className="sgen" role="status" aria-live="polite">
      <div className="sgh"><i className="sgd" />Generating{items.length > 1 ? ` · ${items.length}` : ''}</div>
      <button className="sgt" onClick={() => onOpen(it.id)} title={it.text}>{it.text}</button>
      <div className="sgm">{has ? STAGE_TITLE[stageOf(it.logs)] : 'Starting'} · {dur(sec)}</div>
      <button className="btn sgs" onClick={onStop}><PI k="stop" />Stop</button>
    </div>
  )
}

function Toasts({ list, onClose, onOpen }) {
  if (!list.length) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map(t => (
        <div key={t.id} className={'toast ' + t.kind}>
          <button className="to-b" onClick={() => onOpen(t)}><b>{t.title}</b><span>{t.body}</span></button>
          <button className="to-x" aria-label="Dismiss" onClick={() => onClose(t.id)}><PI k="x" /></button>
        </div>
      ))}
    </div>
  )
}

function Confirm({ cf, onClose }) {
  useEffect(() => {
    if (!cf) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cf, onClose])
  if (!cf) return null
  return (
    <div className="cfw" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cfb" role="alertdialog" aria-modal="true" aria-labelledby="cf-t" aria-describedby="cf-d">
        <h3 id="cf-t">{cf.title}</h3>
        <p id="cf-d">{cf.body}</p>
        <div className="cfa">
          <button className="btn" autoFocus onClick={onClose}>Cancel</button>
          <button className={'btn p' + (cf.danger ? ' dng' : '')} onClick={() => { const run = cf.run; onClose(); run && run() }}>{cf.ok || 'Confirm'}</button>
        </div>
      </div>
    </div>
  )
}

function Sprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }}>
      <defs>
        <symbol id="plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></symbol>
        <symbol id="chat" viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z" /></symbol>
        <symbol id="clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></symbol>
        <symbol id="cube" viewBox="0 0 24 24"><path d="M12 3 4 7.5v9L12 21l8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></symbol>
        <symbol id="gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></symbol>
        <symbol id="clip" viewBox="0 0 24 24"><path d="M20 11l-8 8a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" /></symbol>
        <symbol id="up" viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6" /></symbol>
        <symbol id="dl" viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></symbol>
        <symbol id="side" viewBox="0 0 24 24"><path d="M4 5h16v14H4zM9 5v14" /></symbol>
        <symbol id="tag" viewBox="0 0 24 24"><path d="M3 3h8l10 10-8 8L3 11zM8 8h.01" /></symbol>
        <symbol id="part" viewBox="0 0 100 100"><path d="M50 10 12 30v40l38 20 38-20V30z" /><path d="M12 30l38 20 38-20M50 50v40" /><circle cx="50" cy="30" r="5" /></symbol>
        <symbol id="exp" viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></symbol>
      </defs>
    </svg>
  )
}

function Sw({ def = false, onChange }) {
  const [on, setOn] = useState(def)
  return (
    <button
      role="switch"
      aria-checked={on}
      className={'sw' + (on ? ' on' : '')}
      onClick={() => { setOn(!on); onChange && onChange(!on) }}
    />
  )
}

function Seg({ items, def = 0, className = '', onPick }) {
  const [i, setI] = useState(def)
  return (
    <div className={'seg ' + className}>
      {items.map((t, k) => (
        <button key={t} className={k === i ? 'on' : ''} onClick={() => { setI(k); onPick && onPick(k) }}>{t}</button>
      ))}
    </div>
  )
}

function CopyBtn({ text }) {
  const [ok, setOk] = useState(false)
  const done = () => { setOk(true); setTimeout(() => setOk(false), 1500) }
  const fallback = () => {
    const a = document.createElement('textarea')
    a.value = text
    a.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(a)
    a.select()
    try { document.execCommand('copy') } catch { /* ignore */ }
    a.remove()
    done()
  }
  const copy = () => {
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback)
    else fallback()
  }
  return <button title="Copy" onClick={copy}><PI k={ok ? 'ok' : 'copy'} /></button>
}

function EditBox({ init, onSave, onCancel }) {
  const [v, setV] = useState(init)
  const r = useRef(null)
  useEffect(() => {
    const a = r.current
    a.focus()
    a.style.height = a.scrollHeight + 'px'
  }, [])
  return (
    <div className="ed">
      <textarea ref={r} value={v} onChange={e => setV(e.target.value)} />
      <div className="eb">
        <button className="btn p" onClick={() => onSave(v.trim())}>Save and regenerate</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function Result({ v, onOpen3d, onRefine, onEditShape }) {
  const [showCode, setShowCode] = useState(false)
  const partColors = v.physics && v.physics.part_colors ? v.physics.part_colors : null
  const sf = v.physics && v.physics.overall_safety_factor ? v.physics.overall_safety_factor : null
  return (
    <>
      Generated <b>{v.title}</b> in <b>{v.m}</b>.
      {v.warning && <div style={{ margin: '6px 0', fontSize: 13, opacity: 0.8 }}>Note: {v.warning}</div>}
      <div className="cad">
        <div className="prev" onClick={() => onOpen3d(v)}>
          {v.mesh ? <Thumb mesh={v.mesh} alt={v.title} partColors={partColors} /> : <PartIcon />}
        </div>
        <div className="meta">
          <div><small>Mass</small>{fmtMass(v.mass_g)}</div>
          <div><small>Size</small>{fmtSize(v.bbox)}</div>
          <div title={v.checkNote || ''}>
            <small>Check</small>
            {v.verified ? (sf ? `Verified · SF ${sf}×` : 'Verified') : 'Review'}
          </div>
        </div>
        <div className="acts">
          <button className="btn p" onClick={() => dl(v.job, v.f)}><Ic n="dl" />Download {v.f}</button>
          <button className="btn" onClick={() => onOpen3d(v)}><Ic n="exp" />Enlarge 3D & Crash Lab</button>
          <button className="btn" onClick={() => onRefine(v)}>Refine</button>
          {v.shape && <button className="btn" onClick={() => onEditShape(v)}>Edit shape</button>}
          <button className="btn" onClick={() => setShowCode(s => !s)}>{showCode ? 'Hide code' : 'View code'}</button>
        </div>
        {showCode && (
          <div style={{ marginTop: 10 }}>
            <pre className="code">{v.code}</pre>
            <button className="btn" style={{ marginTop: 6 }} onClick={() => dl(v.job, 'py')}>Download .py</button>
          </div>
        )}
      </div>
      <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>Mass is geometry volume × material density. Open 3D to run Crash & Wind-Shear stress tests.</div>
    </>
  )
}

const nf = (x, d = 1) => Number(x).toLocaleString('en-US', { maximumFractionDigits: d })
const c3 = q => `(${fm(q[0])}, ${fm(q[1])}, ${fm(q[2])})`

function InfoPanel({ v, mesh, pts, measureOn }) {
  const st = useMemo(() => (mesh ? meshStats(mesh) : null), [mesh])
  if (!v) return null
  const [W, D, H] = v.bbox || [0, 0, 0]
  const bmin = v.bmin || (st ? st.min : null)
  const V = v.vol
  const area = v.area || (st ? st.area : null)
  const bv = W * D * H
  const rho = v.density
  const dims = [W, D, H].sort((x, y) => x - y)
  const d3 = pts.length === 2 ? pts[1].map((x, i) => x - pts[0][i]) : null
  const dist = d3 ? Math.hypot(...d3) : 0
  return (
    <div className="ip">
      <h4 className="ih">Coordinate system</h4>
      <div className="eq">Right-handed · Z up<br />Origin O = (0, 0, 0) · units mm</div>

      <h4 className="ih">Bounding box</h4>
      {['X', 'Y', 'Z'].map((ax, i) => (
        <div className="ir" key={ax}>
          <span>{ax}</span>
          <b>{bmin ? `${fm(bmin[i])} → ${fm(bmin[i] + v.bbox[i])}` : ''} <em>Δ {fm(v.bbox[i])}</em></b>
        </div>
      ))}
      <div className="eq">size = W × D × H = {fm(W)} × {fm(D)} × {fm(H)} mm<br />aspect = longest / shortest = {fm(dims[2] / (dims[0] || 1))}</div>

      {V ? (
        <>
          <h4 className="ih">Volume and mass</h4>
          <div className="ir"><span>Volume V</span><b>{nf(V, 0)} mm³ <em>= {nf(V / 1000, 2)} cm³</em></b></div>
          {rho ? <div className="ir"><span>Density ρ</span><b>{rho} g/cm³ <em>{v.m}</em></b></div> : null}
          {rho ? (
            <div className="eq">m = V × ρ<br />= {nf(V, 0)} mm³ × {(rho / 1000).toPrecision(3)} g/mm³<br />= <b>{fmtMass(v.mass_g)}</b></div>
          ) : null}
        </>
      ) : null}

      <h4 className="ih">Surface and shape</h4>
      {area ? <div className="ir"><span>Surface area A</span><b>{nf(area, 0)} mm²{v.area ? '' : ' ≈'}</b></div> : null}
      {area && V ? <div className="ir"><span>A / V</span><b>{nf(area / V, 3)} mm⁻¹</b></div> : null}
      <div className="ir"><span>Box volume</span><b>{nf(bv, 0)} mm³</b></div>
      {V && bv ? (
        <div className="eq">fill = V / (W·D·H)<br />= {nf(V, 0)} / {nf(bv, 0)} = <b>{(V / bv).toFixed(3)}</b> ({(100 * V / bv).toFixed(1)} %)</div>
      ) : null}

      {v.com ? (
        <>
          <h4 className="ih">Centre of mass</h4>
          <div className="eq">C = {c3(v.com)} mm</div>
        </>
      ) : null}

      <h4 className="ih">Topology</h4>
      {v.counts ? (
        <div className="ir"><span>B-rep</span><b>{v.counts.solids} solid · {v.counts.faces} faces · {v.counts.edges} edges · {v.counts.vertices} vertices</b></div>
      ) : null}
      {st ? <div className="ir"><span>Display mesh</span><b>{nf(st.tris, 0)} triangles · {nf(st.verts, 0)} vertices</b></div> : null}

      {measureOn ? (
        <>
          <h4 className="ih">Measurement</h4>
          {pts.length === 0 ? <div className="eq">Click a point on the model (it snaps to the nearest vertex).</div> : null}
          {pts.length >= 1 ? <div className="eq">A = {c3(pts[0])} mm</div> : null}
          {pts.length === 1 ? <div className="eq">Click a second point.</div> : null}
          {d3 ? (
            <div className="eq">
              B = {c3(pts[1])} mm<br />
              Δ = B − A = {c3(d3)}<br />
              d = √(Δx² + Δy² + Δz²)<br />
              = √({fm(d3[0])}² + {fm(d3[1])}² + {fm(d3[2])}²)<br />
              = <b>{fm(dist)} mm</b>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/* Wind tunnel view: ideal (potential) flow around the real side silhouette of the mesh.
   Solves laplace(psi)=0 on a grid with the body as a streamline, then advects particles through
   (u, v) = (dpsi/dy, -dpsi/dx). Bernoulli: faster flow -> lower pressure, Cp = 1 - |v|^2 / U^2.
   Visualisation only (no wake / turbulence), not CFD. */
function WindOverlay({ mesh, partColors, aero, wind, flip, pitch }) {
  const wrapRef = useRef(null)
  const ref = useRef(null)
  const live = useRef({ wind, aero })
  useEffect(() => { live.current = { wind, aero } }, [wind, aero])
  const colKey = JSON.stringify(partColors || {})

  useEffect(() => {
    const cv = ref.current
    const wrap = wrapRef.current
    if (!cv || !wrap || !mesh || !mesh.verts || !mesh.tris) return
    const ctx = cv.getContext('2d')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const rtl = !flip                         // default: air travels from the nose (+X, screen right) to the tail
    const cols = JSON.parse(colKey)
    const V0 = mesh.verts, T = mesh.tris, TP = mesh.tri_part, PN = mesh.parts || []
    const pr = ((pitch || 0) * Math.PI) / 180
    let V = V0
    if (pr) {                                 // pitch: nose up = +, rotate about the bbox centre (side view)
      let ax = Infinity, bx2 = -Infinity, az = Infinity, bz2 = -Infinity
      for (let i = 0; i < V0.length; i += 3) {
        ax = Math.min(ax, V0[i]); bx2 = Math.max(bx2, V0[i])
        az = Math.min(az, V0[i + 2]); bz2 = Math.max(bz2, V0[i + 2])
      }
      const cxm = (ax + bx2) / 2, czm = (az + bz2) / 2, cs = Math.cos(pr), sn = Math.sin(pr)
      V = new Float32Array(V0.length)
      for (let i = 0; i < V0.length; i += 3) {
        const x = V0[i] - cxm, z = V0[i + 2] - czm
        V[i] = cxm + x * cs - z * sn; V[i + 1] = V0[i + 1]; V[i + 2] = czm + x * sn + z * cs
      }
    }
    const nT = Math.floor(T.length / 3)
    let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity
    for (let i = 0; i < V.length; i += 3) {
      if (V[i] < xmin) xmin = V[i]
      if (V[i] > xmax) xmax = V[i]
      if (V[i + 2] < zmin) zmin = V[i + 2]
      if (V[i + 2] > zmax) zmax = V[i + 2]
    }
    if (!isFinite(xmin)) return
    const isWheel = PN.map(n => /wheel|tire|tyre/i.test(String(n)))
    const rgb = h => {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(h || ''))
      const n = m ? parseInt(m[1], 16) : 0x94a3b8
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    }

    let W = 0, H = 0, sc = null, raf = 0, last = performance.now()

    const build = () => {
      const host = cv.closest('.mvw')
      const pnl = host ? host.querySelector('.ip') : null
      const pw = pnl ? Math.round(pnl.getBoundingClientRect().width) : 0
      if (wrap.style.right !== pw + 'px') wrap.style.right = pw + 'px'
      const r = cv.getBoundingClientRect()
      W = r.width; H = r.height
      if (W < 80 || H < 80) { sc = null; return }
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const groundY = H * 0.8
      const bx = xmax - xmin || 1, bz = zmax - zmin || 1
      const s = Math.min((W * 0.5) / bx, (groundY * 0.5) / bz)
      const ox = (W - bx * s) / 2 - xmin * s
      const sx = X => ox + X * s
      const sy = Z => groundY - (Z - zmin) * s
      const mx = xs => (rtl ? W - xs : xs)    // screen <-> canonical (flow always left->right), self-inverse

      // 1) pre-render the car (side view, painter's order by depth)
      const oc = document.createElement('canvas')
      oc.width = cv.width; oc.height = cv.height
      const o = oc.getContext('2d')
      o.setTransform(dpr, 0, 0, dpr, 0, 0)
      const dep = new Float32Array(nT)
      for (let t = 0; t < nT; t++) dep[t] = V[T[3 * t] * 3 + 1] + V[T[3 * t + 1] * 3 + 1] + V[T[3 * t + 2] * 3 + 1]
      const order = Array.from({ length: nT }, (_, t) => t).sort((p, q) => dep[q] - dep[p])
      const stroke = nT < 60000
      o.lineWidth = 0.7
      o.lineJoin = 'round'
      for (const t of order) {
        const a = T[3 * t] * 3, b = T[3 * t + 1] * 3, c = T[3 * t + 2] * 3
        const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2]
        const wx = V[c] - V[a], wy = V[c + 1] - V[a + 1], wz = V[c + 2] - V[a + 2]
        const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx
        const nl = Math.hypot(nx, ny, nz) || 1
        const sh = 0.5 + 0.5 * Math.abs((nx * 0.3 - ny * 0.45 + nz * 0.8) / nl)
        const [r0, g0, b0] = rgb(cols[TP ? PN[TP[t]] : null])
        const col = 'rgb(' + ((r0 * sh) | 0) + ',' + ((g0 * sh) | 0) + ',' + ((b0 * sh) | 0) + ')'
        o.fillStyle = col
        o.strokeStyle = col
        o.beginPath()
        o.moveTo(sx(V[a]), sy(V[a + 2]))
        o.lineTo(sx(V[b]), sy(V[b + 2]))
        o.lineTo(sx(V[c]), sy(V[c + 2]))
        o.closePath()
        o.fill()
        if (stroke) o.stroke()
      }

      // 2) rasterise the body outline (wheels excluded so air can pass underneath)
      const GX = 150
      const GY = Math.max(36, Math.min(110, Math.round((GX * groundY) / W)))
      const cw = W / GX, ch = groundY / GY
      const mask = new Uint8Array(GX * GY)
      const gxOf = X => mx(sx(X)) / cw
      const gyOf = Z => ((Z - zmin) * s) / ch
      for (let t = 0; t < nT; t++) {
        if (TP && isWheel[TP[t]]) continue
        const a = T[3 * t] * 3, b = T[3 * t + 1] * 3, c = T[3 * t + 2] * 3
        const x0 = gxOf(V[a]), y0 = gyOf(V[a + 2])
        const x1 = gxOf(V[b]), y1 = gyOf(V[b + 2])
        const x2 = gxOf(V[c]), y2 = gyOf(V[c + 2])
        const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if (Math.abs(den) < 1e-9) continue
        const i0 = Math.max(0, Math.floor(Math.min(x0, x1, x2))), i1 = Math.min(GX - 1, Math.ceil(Math.max(x0, x1, x2)))
        const j0 = Math.max(0, Math.floor(Math.min(y0, y1, y2))), j1 = Math.min(GY - 1, Math.ceil(Math.max(y0, y1, y2)))
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const px = i + 0.5, py = j + 0.5
            const l1 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / den
            const l2 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / den
            const l3 = 1 - l1 - l2
            if (l1 >= -0.02 && l2 >= -0.02 && l3 >= -0.02) mask[j * GX + i] = 1
          }
        }
      }
      // keep a minimum ground clearance, then close pin-holes column by column
      const minJ = Math.ceil((0.06 * bz * s) / ch)
      for (let i = 0; i < GX; i++) for (let j = 0; j < minJ && j < GY; j++) mask[j * GX + i] = 0
      let gapSum = 0, gapN = 0
      for (let i = 0; i < GX; i++) {
        let lo = -1, hi = -1
        for (let j = 0; j < GY; j++) if (mask[j * GX + i]) { if (lo < 0) lo = j; hi = j }
        if (lo >= 0) {
          for (let j = lo; j <= hi; j++) mask[j * GX + i] = 1
          gapSum += lo; gapN++
        }
      }
      const gapJ = gapN ? Math.max(gapSum / gapN, minJ) : 0

      // 3) stream function: ground psi=0, top psi=GY-1, inflow/outflow psi=j, body psi=psiB
      const psi = new Float32Array(GX * GY)
      const fixed = new Uint8Array(GX * GY)
      const psiB = 1.12 * gapJ              // air under the body runs ~12% faster than free stream
      for (let j = 0; j < GY; j++) {
        for (let i = 0; i < GX; i++) {
          const k = j * GX + i
          if (j === 0) { psi[k] = 0; fixed[k] = 1 }
          else if (j === GY - 1) { psi[k] = GY - 1; fixed[k] = 1 }
          else if (i === 0 || i === GX - 1) { psi[k] = j; fixed[k] = 1 }
          else if (mask[k]) { psi[k] = psiB; fixed[k] = 1 }
          else psi[k] = j
        }
      }
      for (let it = 0; it < 450; it++) {
        for (let j = 1; j < GY - 1; j++) {
          for (let i = 1; i < GX - 1; i++) {
            const k = j * GX + i
            if (fixed[k]) continue
            psi[k] += 1.9 * (0.25 * (psi[k - 1] + psi[k + 1] + psi[k - GX] + psi[k + GX]) - psi[k])
          }
        }
      }
      const U = new Float32Array(GX * GY), Vv = new Float32Array(GX * GY)
      for (let j = 1; j < GY - 1; j++) {
        for (let i = 1; i < GX - 1; i++) {
          const k = j * GX + i
          if (mask[k]) continue
          let u = (psi[k + GX] - psi[k - GX]) / 2
          let v = -(psi[k + 1] - psi[k - 1]) / 2
          const m = Math.hypot(u, v)
          if (m > 3) { u *= 3 / m; v *= 3 / m }
          U[k] = u; Vv[k] = v
        }
      }
      for (let i = 0; i < GX; i++) { U[i] = U[GX + i]; Vv[i] = Vv[GX + i]; U[(GY - 1) * GX + i] = U[(GY - 2) * GX + i]; Vv[(GY - 1) * GX + i] = Vv[(GY - 2) * GX + i] }
      for (let j = 0; j < GY; j++) { U[j * GX] = U[j * GX + 1]; Vv[j * GX] = Vv[j * GX + 1]; U[j * GX + GX - 1] = U[j * GX + GX - 2]; Vv[j * GX + GX - 1] = Vv[j * GX + GX - 2] }

      // 4) particles
      const spawn = (p, anywhere) => {
        for (let n = 0; n < 8; n++) {
          p.gx = anywhere ? Math.random() * GX : 0.6
          p.gy = 0.8 + Math.random() * (GY - 2.2)
          if (!mask[Math.floor(p.gy) * GX + Math.floor(p.gx)]) break
        }
        p.tr = []
        p.cp = 0
      }
      const parts = Array.from({ length: 240 }, () => { const p = {}; spawn(p, true); return p })
      sc = { groundY, GX, GY, cw, ch, mask, U, Vv, oc, parts, spawn, topY: sy(zmax), cxs: sx((xmin + xmax) / 2) }
    }

    const frame = now => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      if (!sc) return
      const { groundY, GX, GY, cw, ch, mask, U, Vv, oc, parts, spawn } = sc
      const wnd = live.current.wind || 0
      const a = live.current.aero || {}
      const Upx = Math.min(Math.max(wnd * 5, 0), 700)      // wind speed -> on-screen speed
      const kAll = (Upx / cw) * dt
      const steps = Math.max(1, Math.ceil(kAll * 1.5))
      const kk = kAll / steps

      for (const p of parts) {
        for (let n = 0; n < steps; n++) {
          const fx = Math.min(Math.max(p.gx - 0.5, 0), GX - 1.001)
          const fy = Math.min(Math.max(p.gy - 0.5, 0), GY - 1.001)
          const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, k = j * GX + i
          const u = (U[k] * (1 - tx) + U[k + 1] * tx) * (1 - ty) + (U[k + GX] * (1 - tx) + U[k + GX + 1] * tx) * ty
          const v = (Vv[k] * (1 - tx) + Vv[k + 1] * tx) * (1 - ty) + (Vv[k + GX] * (1 - tx) + Vv[k + GX + 1] * tx) * ty
          p.cp = 1 - (u * u + v * v)
          p.gx += u * kk
          p.gy += v * kk
        }
        if (p.gx >= GX - 0.6 || p.gx < 0 || p.gy < 0.3 || p.gy > GY - 0.3 || mask[Math.floor(p.gy) * GX + Math.floor(p.gx)]) {
          spawn(p, false)
        } else if (kAll > 0) {
          p.tr.push([p.gx, p.gy])
          if (p.tr.length > 10) p.tr.shift()
        }
      }

      ctx.fillStyle = '#0b0e13'
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#11161d'
      ctx.fillRect(0, groundY, W, H - groundY)
      ctx.strokeStyle = '#475569'
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(W, groundY); ctx.stroke()

      const PX = g => (rtl ? W - g[0] * cw : g[0] * cw)
      const PY = g => groundY - g[1] * ch
      ctx.lineCap = 'round'
      ctx.lineWidth = 1.7
      for (const p of parts) {
        const L = p.tr.length
        if (L < 2) continue
        const hue = p.cp < 0 ? 200 : 28
        const base = 0.3 + Math.min(Math.abs(p.cp) * 1.1, 0.6)
        for (let c = 0; c < 3; c++) {
          const s0 = Math.floor(((L - 1) * c) / 3)
          const s1 = Math.min(L - 1, Math.floor(((L - 1) * (c + 1)) / 3) + 1)
          ctx.strokeStyle = 'hsla(' + hue + ',90%,62%,' + (base * (0.3 + 0.35 * c)).toFixed(3) + ')'
          ctx.beginPath()
          ctx.moveTo(PX(p.tr[s0]), PY(p.tr[s0]))
          for (let q = s0 + 1; q <= s1; q++) ctx.lineTo(PX(p.tr[q]), PY(p.tr[q]))
          ctx.stroke()
        }
      }

      ctx.drawImage(oc, 0, 0, W, H)

      // lift / downforce arrow above the body
      if (a.lift_force_n !== undefined) {
        const F = a.lift_force_n
        const down = F < 0
        const len = Math.min(90, 28 + Math.log10(1 + Math.abs(F)) * 20)
        const x = sc.cxs
        const yTip = down ? sc.topY - 14 : sc.topY - 14 - len
        const yTail = down ? sc.topY - 14 - len : sc.topY - 14
        const col = down ? '#10b981' : '#f59e0b'
        const hd = down ? 1 : -1
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 3
        ctx.beginPath(); ctx.moveTo(x, yTail); ctx.lineTo(x, yTip - hd * 4); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(x, yTip); ctx.lineTo(x - 7, yTip - hd * 11); ctx.lineTo(x + 7, yTip - hd * 11); ctx.closePath(); ctx.fill()
        ctx.font = '600 12px system-ui, sans-serif'
        ctx.textAlign = 'left'
        ctx.fillText((down ? 'Downforce ' : 'Lift ') + Math.abs(F).toFixed(0) + ' N', x + 12, (yTail + yTip) / 2 + 4)
      }

      // HUD below the ground line
      ctx.textAlign = 'left'
      ctx.font = '600 12px system-ui, sans-serif'
      ctx.fillStyle = 'rgba(226,232,240,0.95)'
      ctx.fillText('Wind ' + wnd.toFixed(0) + ' m/s (' + (wnd * 3.6).toFixed(0) + ' km/h)' + (a.dynamic_pressure_pa ? ' · q ' + a.dynamic_pressure_pa + ' Pa' : ''), 14, groundY + 26)
      ctx.font = '11px system-ui, sans-serif'
      ctx.fillStyle = 'hsl(200,90%,62%)'; ctx.fillText('● fast flow = low pressure (suction)', 14, groundY + 46)
      ctx.fillStyle = 'hsl(28,90%,62%)'; ctx.fillText('● slow flow = high pressure', 14, groundY + 62)
      ctx.fillStyle = 'rgba(148,163,184,0.8)'
      ctx.fillText('Ideal-flow view of the real outline (no wake). Panel numbers are the Bernoulli estimate.', 14, H - 10)
    }

    build()
    const ro = new ResizeObserver(build)
    ro.observe(cv)
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [mesh, flip, colKey, pitch])

  return (
    <div ref={wrapRef} style={{ position: 'absolute', top: 0, left: 0, bottom: 0, right: 0, zIndex: 1, pointerEvents: 'none' }}>
      <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  )
}

/* Keeps a failure in the flow view from blanking the whole app */
class FlowBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err) { console.error('Flow view failed:', err) }
  render() {
    if (this.state.err) {
      return (
        <div style={{ position: 'absolute', top: 70, left: 14, right: 344, zIndex: 1, padding: 12, borderRadius: 8, background: 'rgba(127,29,29,0.85)', color: '#fecaca', fontSize: 12 }}>
          <b>Flow view failed:</b> {String((this.state.err && this.state.err.message) || this.state.err)}
          <div style={{ opacity: 0.8, marginTop: 4 }}>Toggle “3D flow” or “Airflow” in the toolbar. Details are in the browser console.</div>
        </div>
      )
    }
    return this.props.children
  }
}

/* True 3D wind tunnel: voxel potential flow (laplace(phi)=0, body = no-penetration) around the real mesh.
   Wind yaw / pitch are applied by turning the model on a "turntable", like a real tunnel.
   Ideal flow, no wake or turbulence: a visualisation, not CFD. */
function WindTunnel3D({ mesh, partColors, aero, wind, yaw, pitch }) {
  const wrapRef = useRef(null)
  const hudRef = useRef(null)
  const cam = useRef({ az: -0.85, el: 0.42, r: 70 })
  const live = useRef({ wind, aero })
  useEffect(() => { live.current = { wind, aero } }, [wind, aero])
  const colKey = JSON.stringify(partColors || {})

  useEffect(() => {
    const wrap = wrapRef.current, hud = hudRef.current
    if (!wrap || !mesh || !mesh.verts || !mesh.tris) return
    const host = wrap.closest('.mvw')
    const pnl = host ? host.querySelector('.ip') : null
    wrap.style.right = (pnl ? Math.round(pnl.getBoundingClientRect().width) : 0) + 'px'

    const V0 = mesh.verts, T = mesh.tris, TP = mesh.tri_part, PN = mesh.parts || []
    const nT = Math.floor(T.length / 3), nV = Math.floor(V0.length / 3)
    const cols = JSON.parse(colKey)
    const hexRgb = h => {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(h || ''))
      const n = m ? parseInt(m[1], 16) : 0x94a3b8
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
    }

    // ---- 1) turntable: nose into the wind, then yaw (about Z) and pitch (nose up = +)
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (let i = 0; i < nV; i++) {
      const x = V0[3 * i], y = V0[3 * i + 1], z = V0[3 * i + 2]
      if (x < x0) x0 = x; if (x > x1) x1 = x
      if (y < y0) y0 = y; if (y > y1) y1 = y
      if (z < z0) z0 = z; if (z > z1) z1 = z
    }
    if (!isFinite(x0)) return
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2
    const yw = (yaw * Math.PI) / 180, pt = (pitch * Math.PI) / 180
    const cyw = Math.cos(yw), syw = Math.sin(yw), cpt = Math.cos(pt), spt = Math.sin(pt)
    const tv = new Float32Array(nV * 3)
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity, bz0 = Infinity, bz1 = -Infinity
    for (let i = 0; i < nV; i++) {
      let x = -(V0[3 * i] - cx), y = -(V0[3 * i + 1] - cy)
      const z = V0[3 * i + 2] - cz
      const xa = x * cyw - y * syw, ya = x * syw + y * cyw
      const xb = xa * cpt + z * spt, zb = -xa * spt + z * cpt
      tv[3 * i] = xb; tv[3 * i + 1] = ya; tv[3 * i + 2] = zb
      if (xb < bx0) bx0 = xb; if (xb > bx1) bx1 = xb
      if (ya < by0) by0 = ya; if (ya > by1) by1 = ya
      if (zb < bz0) bz0 = zb; if (zb > bz1) bz1 = zb
    }

    // ---- 2) grid (cell units): flow runs along +x
    const NX = 96, NY = 44, NZ = 36, NXY = NX * NY, N = NXY * NZ
    const h = Math.max((bx1 - bx0) / 38, (by1 - by0) / 20, (bz1 - bz0) / 14, 1e-6)
    const gv = new Float32Array(nV * 3)
    for (let i = 0; i < nV; i++) {
      gv[3 * i] = (tv[3 * i] - bx0) / h + 22
      gv[3 * i + 1] = (tv[3 * i + 1] - (by0 + by1) / 2) / h + NY / 2
      gv[3 * i + 2] = (tv[3 * i + 2] - bz0) / h + 1
    }
    const cmin = [22, NY / 2 - (by1 - by0) / h / 2, 1]
    const cmax = [22 + (bx1 - bx0) / h, NY / 2 + (by1 - by0) / h / 2, 1 + (bz1 - bz0) / h]

    // ---- 3) three.js scene
    const cv = document.createElement('canvas')
    cv.style.cssText = 'width:100%;height:100%;display:block'
    wrap.insertBefore(cv, wrap.firstChild)
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true })
    } catch (err) {
      cv.remove()
      if (hud) hud.textContent = '3D view needs WebGL: ' + (err && err.message)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0b0e13)
    const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 700)
    camera.up.set(0, 0, 1)
    scene.add(new THREE.AmbientLight(0xffffff, 0.8))
    const dl = new THREE.DirectionalLight(0xffffff, 1.1)
    dl.position.set(30, -50, 80)
    scene.add(dl)

    const pos = new Float32Array(nT * 9), colr = new Float32Array(nT * 9)
    for (let t = 0; t < nT; t++) {
      const [r0, g0, b0] = hexRgb(cols[TP ? PN[TP[t]] : null])
      for (let c = 0; c < 3; c++) {
        const vi = T[3 * t + c]
        const o = 9 * t + 3 * c
        pos[o] = gv[3 * vi]; pos[o + 1] = gv[3 * vi + 1]; pos[o + 2] = gv[3 * vi + 2]
        colr[o] = r0; colr[o + 1] = g0; colr[o + 2] = b0
      }
    }
    const carGeo = new THREE.BufferGeometry()
    carGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    carGeo.setAttribute('color', new THREE.BufferAttribute(colr, 3))
    carGeo.computeVertexNormals()
    const carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide })
    scene.add(new THREE.Mesh(carGeo, carMat))

    const grid = new THREE.GridHelper(96, 48, 0x334155, 0x1a212c)
    grid.rotation.x = Math.PI / 2
    grid.position.set(NX / 2, NY / 2, 0)
    scene.add(grid)
    const boxGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(NX, NY, NZ))
    const box = new THREE.LineSegments(boxGeo, new THREE.LineBasicMaterial({ color: 0x243044 }))
    box.position.set(NX / 2, NY / 2, NZ / 2)
    scene.add(box)
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 0), 8, 0x10b981, 2.2, 1.4)
    arrow.visible = false
    scene.add(arrow)

    // ---- 4) voxelise the surface (dense sampling), flood-fill the outside air
    const solid = new Uint8Array(N)
    const mark = (x, y, z) => {
      const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z)
      if (i >= 0 && i < NX && j >= 0 && j < NY && k >= 0 && k < NZ) solid[(k * NY + j) * NX + i] = 1
    }
    for (let t = 0; t < nT; t++) {
      const a = T[3 * t] * 3, b = T[3 * t + 1] * 3, c = T[3 * t + 2] * 3
      const ax = gv[a], ay = gv[a + 1], az = gv[a + 2]
      const bx = gv[b], by = gv[b + 1], bz = gv[b + 2]
      const ccx = gv[c], ccy = gv[c + 1], ccz = gv[c + 2]
      const e = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(ccx - ax, ccy - ay, ccz - az), Math.hypot(ccx - bx, ccy - by, ccz - bz))
      const n = Math.min(120, Math.max(1, Math.ceil(e * 2)))
      for (let p = 0; p <= n; p++) {
        for (let q = 0; q <= n - p; q++) {
          const u = p / n, v = q / n, w = 1 - u - v
          mark(ax * w + bx * u + ccx * v, ay * w + by * u + ccy * v, az * w + bz * u + ccz * v)
        }
      }
    }
    const air = new Uint8Array(N)
    {
      const qu = new Int32Array(N)
      let qh = 0, qt = 0
      if (!solid[0]) { air[0] = 1; qu[qt++] = 0 }
      while (qh < qt) {
        const k = qu[qh++]
        const i = k % NX, j = Math.floor(k / NX) % NY, kz = Math.floor(k / NXY)
        if (i > 0 && !air[k - 1] && !solid[k - 1]) { air[k - 1] = 1; qu[qt++] = k - 1 }
        if (i < NX - 1 && !air[k + 1] && !solid[k + 1]) { air[k + 1] = 1; qu[qt++] = k + 1 }
        if (j > 0 && !air[k - NX] && !solid[k - NX]) { air[k - NX] = 1; qu[qt++] = k - NX }
        if (j < NY - 1 && !air[k + NX] && !solid[k + NX]) { air[k + NX] = 1; qu[qt++] = k + NX }
        if (kz > 0 && !air[k - NXY] && !solid[k - NXY]) { air[k - NXY] = 1; qu[qt++] = k - NXY }
        if (kz < NZ - 1 && !air[k + NXY] && !solid[k + NXY]) { air[k + NXY] = 1; qu[qt++] = k + NXY }
      }
    }

    // ---- 5) potential flow: neighbours that are solid / outside the walls are skipped (no-penetration)
    const nb = new Uint8Array(N), cnt = new Uint8Array(N), phi = new Float32Array(N)
    const cellList = []
    for (let kz = 0; kz < NZ; kz++) {
      for (let j = 0; j < NY; j++) {
        for (let i = 0; i < NX; i++) {
          const k = (kz * NY + j) * NX + i
          phi[k] = i
          if (!air[k]) continue
          let m = 0
          if (i > 0 && air[k - 1]) m |= 1
          if (i < NX - 1 && air[k + 1]) m |= 2
          if (j > 0 && air[k - NX]) m |= 4
          if (j < NY - 1 && air[k + NX]) m |= 8
          if (kz > 0 && air[k - NXY]) m |= 16
          if (kz < NZ - 1 && air[k + NXY]) m |= 32
          nb[k] = m
          cnt[k] = (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1) + ((m >> 4) & 1) + ((m >> 5) & 1)
          if (i > 0 && i < NX - 1 && cnt[k]) cellList.push(k)
        }
      }
    }
    const cells = Int32Array.from(cellList)
    const nc = cells.length
    const OMEGA = 1.85, MAXS = 420
    const sweep = () => {
      for (let n = 0; n < nc; n++) {
        const k = cells[n], m = nb[k]
        let s = 0
        if (m & 1) s += phi[k - 1]
        if (m & 2) s += phi[k + 1]
        if (m & 4) s += phi[k - NX]
        if (m & 8) s += phi[k + NX]
        if (m & 16) s += phi[k - NXY]
        if (m & 32) s += phi[k + NXY]
        phi[k] += OMEGA * (s / cnt[k] - phi[k])
      }
    }
    const ux = new Float32Array(N), uy = new Float32Array(N), uz = new Float32Array(N)
    const computeVel = () => {
      for (let n = 0; n < nc; n++) {
        const k = cells[n], m = nb[k]
        const dx = (m & 1) && (m & 2) ? (phi[k + 1] - phi[k - 1]) / 2 : (m & 2) ? phi[k + 1] - phi[k] : (m & 1) ? phi[k] - phi[k - 1] : 0
        const dy = (m & 4) && (m & 8) ? (phi[k + NX] - phi[k - NX]) / 2 : (m & 8) ? phi[k + NX] - phi[k] : (m & 4) ? phi[k] - phi[k - NX] : 0
        const dz = (m & 16) && (m & 32) ? (phi[k + NXY] - phi[k - NXY]) / 2 : (m & 32) ? phi[k + NXY] - phi[k] : (m & 16) ? phi[k] - phi[k - NXY] : 0
        const mg = Math.hypot(dx, dy, dz)
        const sc = mg > 3 ? 3 / mg : 1
        ux[k] = dx * sc; uy[k] = dy * sc; uz[k] = dz * sc
      }
      for (let kz = 0; kz < NZ; kz++) for (let j = 0; j < NY; j++) {
        const a0 = (kz * NY + j) * NX, a1 = a0 + NX - 1
        if (air[a0]) { ux[a0] = 1 }
        if (air[a1]) { ux[a1] = 1 }
      }
    }

    // ---- 6) particles with trails
    const M = 650, TL = 16
    const pgx = new Float32Array(M), pgy = new Float32Array(M), pgz = new Float32Array(M), pcp = new Float32Array(M)
    const trails = new Float32Array(M * TL * 3), tn = new Uint8Array(M)
    const yLo = Math.max(1, cmin[1] - 5), yHi = Math.min(NY - 1, cmax[1] + 5), zHi = Math.min(NZ - 1, cmax[2] + 5)
    const spawn = (p, anywhere) => {
      for (let n = 0; n < 10; n++) {
        pgx[p] = anywhere ? 1 + Math.random() * (NX - 3) : 0.7
        pgy[p] = yLo + Math.random() * (yHi - yLo)
        pgz[p] = 0.6 + Math.random() * (zHi - 0.6)
        if (air[(Math.floor(pgz[p]) * NY + Math.floor(pgy[p])) * NX + Math.floor(pgx[p])]) break
      }
      tn[p] = 0
    }
    const sv = [0, 0, 0]
    const samp = (gx, gy, gz) => {
      const fx = Math.min(Math.max(gx - 0.5, 0), NX - 1.001)
      const fy = Math.min(Math.max(gy - 0.5, 0), NY - 1.001)
      const fz = Math.min(Math.max(gz - 0.5, 0), NZ - 1.001)
      const i = Math.floor(fx), j = Math.floor(fy), kq = Math.floor(fz)
      const tx = fx - i, ty = fy - j, tz = fz - kq
      const b = (kq * NY + j) * NX + i
      let ax = 0, ay = 0, az = 0
      for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz)
        const o = b + dx + dy * NX + dz * NXY
        ax += ux[o] * w; ay += uy[o] * w; az += uz[o] * w
      }
      sv[0] = ax; sv[1] = ay; sv[2] = az
    }
    const lp = new Float32Array(M * (TL - 1) * 6), lc = new Float32Array(M * (TL - 1) * 6)
    const lGeo = new THREE.BufferGeometry()
    lGeo.setAttribute('position', new THREE.BufferAttribute(lp, 3))
    lGeo.setAttribute('color', new THREE.BufferAttribute(lc, 3))
    const lMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    const lines = new THREE.LineSegments(lGeo, lMat)
    lines.frustumCulled = false
    scene.add(lines)

    // ---- 7) orbit controls + resize
    let drag = null
    const onDown = e => { drag = { x: e.clientX, y: e.clientY }; if (wrap.setPointerCapture) { try { wrap.setPointerCapture(e.pointerId) } catch { /* ignore */ } } }
    const onMove = e => {
      if (!drag) return
      cam.current.az -= (e.clientX - drag.x) * 0.006
      cam.current.el = Math.max(-0.1, Math.min(1.45, cam.current.el + (e.clientY - drag.y) * 0.006))
      drag = { x: e.clientX, y: e.clientY }
    }
    const onUp = () => { drag = null }
    const onWheel = e => { e.preventDefault(); cam.current.r = Math.max(20, Math.min(160, cam.current.r * Math.exp(e.deltaY * 0.001))) }
    wrap.addEventListener('pointerdown', onDown)
    wrap.addEventListener('pointermove', onMove)
    wrap.addEventListener('pointerup', onUp)
    wrap.addEventListener('pointercancel', onUp)
    wrap.addEventListener('wheel', onWheel, { passive: false })
    const fit = () => {
      const w = Math.max(1, wrap.clientWidth), hh = Math.max(1, wrap.clientHeight)
      renderer.setSize(w, hh, false)
      camera.aspect = w / hh
      camera.updateProjectionMatrix()
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(wrap)

    // ---- 8) loop
    let raf = 0, last = performance.now(), frames = 0, sweeps = 0, solved = false
    const down = new THREE.Vector3(0, 0, -1), up = new THREE.Vector3(0, 0, 1)
    const frame = now => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      frames++
      if (!solved) {
        const t0 = performance.now()
        while (sweeps < MAXS && performance.now() - t0 < 10) { sweep(); sweeps++ }
        if (sweeps >= MAXS) {
          computeVel()
          for (let p = 0; p < M; p++) spawn(p, true)
          solved = true
        }
      }
      const wnd = Math.max(live.current.wind || 0, 0)
      const a = live.current.aero || {}
      let o = 0
      if (solved) {
        const kAll = wnd * 0.18 * dt
        const steps = Math.max(1, Math.ceil(kAll * 1.5))
        const kk = kAll / steps
        for (let p = 0; p < M; p++) {
          for (let n = 0; n < steps; n++) {
            samp(pgx[p], pgy[p], pgz[p])
            pcp[p] = 1 - (sv[0] * sv[0] + sv[1] * sv[1] + sv[2] * sv[2])
            pgx[p] += sv[0] * kk; pgy[p] += sv[1] * kk; pgz[p] += sv[2] * kk
          }
          const gx = pgx[p], gy = pgy[p], gz = pgz[p]
          if (gx >= NX - 1.2 || gx < 0 || gy < 0.2 || gy > NY - 0.2 || gz < 0.2 || gz > NZ - 0.2 ||
              !air[(Math.floor(gz) * NY + Math.floor(gy)) * NX + Math.floor(gx)]) {
            spawn(p, false)
          } else if (kAll > 0) {
            const base = p * TL * 3
            trails.copyWithin(base + 3, base, base + (TL - 1) * 3)
            trails[base] = gx; trails[base + 1] = gy; trails[base + 2] = gz
            if (tn[p] < TL) tn[p]++
          }
        }
        for (let p = 0; p < M; p++) {
          const n = tn[p], cp = pcp[p]
          const amt = Math.min(Math.abs(cp), 1)
          const cr = cp < 0 ? 0.25 : 1.0, cg = cp < 0 ? 0.65 : 0.55, cb = cp < 0 ? 1.0 : 0.18
          const bright = 0.6 + 0.4 * amt
          for (let q = 0; q < TL - 1; q++, o += 6) {
            if (q < n - 1) {
              const s0 = (p * TL + q) * 3, s1 = s0 + 3
              lp[o] = trails[s0]; lp[o + 1] = trails[s0 + 1]; lp[o + 2] = trails[s0 + 2]
              lp[o + 3] = trails[s1]; lp[o + 4] = trails[s1 + 1]; lp[o + 5] = trails[s1 + 2]
              const f = (1 - q / (TL - 1)) * bright
              lc[o] = cr * f; lc[o + 1] = cg * f; lc[o + 2] = cb * f
              lc[o + 3] = cr * f * 0.85; lc[o + 4] = cg * f * 0.85; lc[o + 5] = cb * f * 0.85
            } else {
              lc[o] = lc[o + 1] = lc[o + 2] = lc[o + 3] = lc[o + 4] = lc[o + 5] = 0
              lp[o] = lp[o + 1] = lp[o + 2] = lp[o + 3] = lp[o + 4] = lp[o + 5] = 0
            }
          }
        }
        lGeo.attributes.position.needsUpdate = true
        lGeo.attributes.color.needsUpdate = true
      }

      // lift / downforce arrow
      const F = a.lift_force_n
      if (F !== undefined) {
        const len = Math.min(14, 4 + Math.log10(1 + Math.abs(F)) * 3)
        const cxg = (cmin[0] + cmax[0]) / 2, cyg = (cmin[1] + cmax[1]) / 2
        arrow.visible = true
        arrow.setColor(F < 0 ? 0x10b981 : 0xf59e0b)
        if (F < 0) { arrow.position.set(cxg, cyg, cmax[2] + 2 + len); arrow.setDirection(down) }
        else { arrow.position.set(cxg, cyg, cmax[2] + 2); arrow.setDirection(up) }
        arrow.setLength(len, Math.min(3, len * 0.3), Math.min(1.8, len * 0.2))
      } else arrow.visible = false

      // camera
      const c = cam.current
      const tx = (cmin[0] + cmax[0]) / 2 + 6, ty = NY / 2, tz = (cmin[2] + cmax[2]) / 2
      camera.position.set(tx + c.r * Math.cos(c.el) * Math.cos(c.az), ty + c.r * Math.cos(c.el) * Math.sin(c.az), tz + c.r * Math.sin(c.el))
      camera.lookAt(tx, ty, tz)
      renderer.render(scene, camera)

      if (hud && frames % 8 === 0) {
        let txt = 'Wind ' + wnd.toFixed(0) + ' m/s (' + (wnd * 3.6).toFixed(0) + ' km/h) · yaw ' + yaw + '° · pitch ' + pitch + '°'
        if (!solved) txt += '\nSolving 3D flow… ' + Math.round((100 * sweeps) / MAXS) + '%'
        else if (F !== undefined) {
          txt += '\n' + (F < 0 ? 'Downforce ' : 'Lift ') + Math.abs(F).toFixed(0) + ' N'
          if (a.side_force_n) txt += ' · side force ' + Math.abs(a.side_force_n).toFixed(0) + ' N'
        }
        hud.textContent = txt
      }
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      wrap.removeEventListener('pointerdown', onDown)
      wrap.removeEventListener('pointermove', onMove)
      wrap.removeEventListener('pointerup', onUp)
      wrap.removeEventListener('pointercancel', onUp)
      wrap.removeEventListener('wheel', onWheel)
      carGeo.dispose(); carMat.dispose(); lGeo.dispose(); lMat.dispose(); boxGeo.dispose()
      renderer.dispose()
      cv.remove()
    }
  }, [mesh, colKey, yaw, pitch])

  return (
    <div ref={wrapRef} style={{ position: 'absolute', top: 0, left: 0, bottom: 0, right: 0, zIndex: 1, cursor: 'grab', touchAction: 'none' }}>
      <div style={{ position: 'absolute', left: 14, bottom: 12, fontSize: 12, lineHeight: 1.5, color: 'rgba(226,232,240,0.95)', pointerEvents: 'none' }}>
        <div ref={hudRef} style={{ whiteSpace: 'pre', fontWeight: 600 }} />
        <div style={{ color: 'hsl(200,90%,62%)', fontSize: 11 }}>● fast flow = low pressure (suction)</div>
        <div style={{ color: 'hsl(28,90%,62%)', fontSize: 11 }}>● slow flow = high pressure</div>
        <div style={{ color: 'rgba(148,163,184,0.85)', fontSize: 11 }}>Drag to orbit · scroll to zoom · ideal flow (no wake)</div>
      </div>
    </div>
  )
}

function MeshModal({ s, onClose, onGoPricing }) {
  const [wire, setWire] = useState(false)
  const [auto, setAuto] = useState(true)
  const [rk, setRk] = useState(0)
  const [dims, setDims] = useState(true)
  const [axes, setAxes] = useState(true)
  const [grid, setGrid] = useState(false)
  const [measure, setMeasure] = useState(false)
  const [info, setInfo] = useState(false)
  const [lab, setLab] = useState(false)
  const [pts, setPts] = useState([])
  const [ck, setCk] = useState(0)

  const [obstacle, setObstacle] = useState('concrete_wall')
  const [speed, setSpeed] = useState(72)
  const [wind, setWind] = useState(45)
  const [simMat, setSimMat] = useState('Al 6061')
  const [partMats, setPartMats] = useState({})
  const [customColors, setCustomColors] = useState({})
  const [physData, setPhysData] = useState(null)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [flipDirection, setFlipDirection] = useState(false)
  const [airflow, setAirflow] = useState(true)
  const [flow3d, setFlow3d] = useState(true)
  const [yaw, setYaw] = useState(0)
  const [pitch, setPitch] = useState(0)
  const [flowAng, setFlowAng] = useState({ yaw: 0, pitch: 0 })
  useEffect(() => {
    const t = setTimeout(() => setFlowAng({ yaw, pitch }), 350)
    return () => clearTimeout(t)
  }, [yaw, pitch])
  const [simAnim, setSimAnim] = useState({ active: false, runId: 0, crumpleRatio: 0.18, obstacle: 'concrete_wall' })

  useEffect(() => {
    if (!s.open) return
    setWire(false)
    setAuto(((s.mesh && s.mesh.tris ? s.mesh.tris.length : 0) / 3) < 25000)
    setRk(k => k + 1)
    setDims(true)
    setAxes(true)
    setGrid(false)
    setMeasure(false)
    setPts([])
    setInfo(window.innerWidth >= 1100)
    setLab(false)
    setFlipDirection(false)
    setYaw(0)
    setPitch(0)
    setFlowAng({ yaw: 0, pitch: 0 })
    const initPhys = s.info && s.info.physics ? s.info.physics : null
    setPhysData(initPhys)
    setSimMat((s.info && s.info.m) || 'Al 6061')
    setPartMats((initPhys && initPhys.part_materials) || {})
    setCustomColors((initPhys && initPhys.part_colors) || {})
    setSimAnim({ active: false, runId: 0, crumpleRatio: 0.18, obstacle: 'concrete_wall' })
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s.open, s.job, s.info, s.mesh, onClose])

  const runCrashSim = async ov0 => {
    const isAero = obstacle === 'wind_tunnel'
    const ov = ov0 && ov0.aeroOv ? ov0 : {}
    const wNow = ov.wind !== undefined ? ov.wind : wind
    const yNow = ov.yaw !== undefined ? ov.yaw : yaw
    const pNow = ov.pitch !== undefined ? ov.pitch : pitch
    setAuto(false)
    const estCr = Math.min(0.58, 0.08 + (speed / 220) * 0.35)
    const nextRunId = Date.now()

    if (isAero) {
      // Aero mode: no crash animation, just fetch the Bernoulli numbers
      setSimAnim(prev => ({ ...prev, active: false, obstacle }))
    } else {
      setSimAnim(prev => ({
        active: true,
        runId: nextRunId,
        crumpleRatio: prev.crumpleRatio || estCr,
        obstacle,
        failureMode: prev.failureMode || 'ductile_crumple',
        impactAxis: prev.impactAxis || null
      }))
    }

    try {
      if (s.job) {
        const res = await simulatePhysics(s.job, {
          material: simMat,
          speed_kmh: speed,
          wind_m_s: wNow,
          wind_yaw_deg: yNow,
          wind_pitch_deg: pNow,
          obstacle,
          part_materials: partMats
        })
        if (res && res.physics) {
          setPhysData(res.physics)
          if (!isAero) {
            const ct = res.physics.edge_cases?.crash_test || {}
            setSimAnim(prev => ({
              ...prev,
              crumpleRatio: ct.crumple_ratio || estCr,
              failureMode: ct.failure_mode || 'ductile_crumple',
              impactAxis: ct.impact_axis || res.physics.impact_axis || null
            }))
          }
        }
      }
    } catch {
      /* keep local estimate */
    }
  }

  const aeroTimer = useRef(null)
  useEffect(() => () => clearTimeout(aeroTimer.current), [])
  const rerunAero = ov => {
    if (obstacle !== 'wind_tunnel') return
    clearTimeout(aeroTimer.current)
    aeroTimer.current = setTimeout(() => runCrashSim({ aeroOv: 1, ...ov }), 300)
  }
  const onWind = v => { setWind(v); rerunAero({ wind: v, yaw, pitch }) }
  const onYaw = v => { setYaw(v); rerunAero({ wind, yaw: v, pitch }) }
  const onPitch = v => { setPitch(v); rerunAero({ wind, yaw, pitch: v }) }

  const resetSim = () => {
    setSimAnim({ active: false, runId: 0, crumpleRatio: 0.18, obstacle })
  }

  const baseColors = (physData && physData.part_colors) || (s.info?.physics?.part_colors) || {}
  const partColors = { ...baseColors, ...customColors }
  const crash = physData?.edge_cases?.crash_test
  const windTest = physData?.edge_cases?.wind_shear
  const buckTest = physData?.edge_cases?.axial_buckling
  const aeroTest = physData?.edge_cases?.bernoulli_aerodynamics

  const tgl = (on, set, label, extra) => (
    <button className={'btn' + (on ? ' on' : '')} onClick={() => set(x => !x)} aria-pressed={on} {...extra}>{label}</button>
  )
  return (
    <div className={'modal' + (s.open ? ' on' : '')} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mbox">
        <div className="mh">
          <b>{s.name}</b>
          <button className="btn mclose" onClick={onClose}>Close</button>
          <div className="g">
            <button className={'btn' + (lab ? ' on' : '')} onClick={() => { setLab(l => !l); if (!lab) setInfo(false) }}>
              ⚡ Physics & Crash Lab
            </button>
            <button className={'btn' + (wire ? ' on' : '')} onClick={() => setWire(w => !w)}>{wire ? 'Wireframe' : 'Shaded'}</button>
            <button className={'btn' + (auto ? ' on' : '')} onClick={() => setAuto(a => !a)}>Auto-rotate</button>
            <button className="btn" onClick={() => { resetSim(); setRk(k => k + 1) }}>Reset view</button>
            <button className="btn p gdl" onClick={() => dl(s.job, s.f)}><Ic n="dl" />Download {s.f}</button>
            <button className="btn gclose" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="mvw">
          {s.open && s.mesh
            ? <MeshViewer mesh={s.mesh} wire={wire} auto={auto} resetKey={rk} dims={dims} axes={axes} grid={grid}
                measure={measure} clearKey={ck} onMeasure={setPts} partColors={partColors}
                simState={{ ...simAnim, showHeatmap, speed, wind, partMats, simMat, flipDirection }}
                edgeCases={physData?.edge_cases} />

            : <div className="mv nomesh">Preview not available</div>}
          {lab && airflow && obstacle === 'wind_tunnel' && aeroTest && s.mesh
            ? (
              <FlowBoundary key={flow3d ? '3d' : '2d'}>
                {flow3d
                  ? <WindTunnel3D mesh={s.mesh} partColors={partColors} aero={aeroTest} wind={wind} yaw={flowAng.yaw} pitch={flowAng.pitch} />
                  : <WindOverlay mesh={s.mesh} partColors={partColors} aero={aeroTest} wind={wind} flip={flipDirection} pitch={flowAng.pitch} />}
              </FlowBoundary>
            ) : null}
          <div className="vt">
            {tgl(dims, setDims, 'Dimensions')}
            {tgl(axes, setAxes, 'Axes')}
            {tgl(grid, setGrid, 'Grid')}
            {tgl(airflow, setAirflow, 'Airflow')}
            {airflow && obstacle === 'wind_tunnel' ? tgl(flow3d, setFlow3d, '3D flow') : null}
            <button className={'btn' + (measure ? ' on' : '')} aria-pressed={measure}
              onClick={() => { setMeasure(m => !m); setAuto(false) }}>Measure</button>
            {measure && pts.length > 0 ? <button className="btn" onClick={() => setCk(k => k + 1)}>Clear</button> : null}
            {tgl(info, setInfo, 'Info')}
            <button className={'btn' + (lab ? ' on' : '')} onClick={() => { setLab(l => !l); if (!lab) setInfo(false) }}>Crash Lab</button>
          </div>
          {info && !lab && s.info ? <InfoPanel v={s.info} mesh={s.mesh} pts={pts} measureOn={measure} /> : null}

          {lab && (
            <div className="ip" style={{ width: 330, maxHeight: '84%', overflowY: 'auto' }}>
              <h4 className="ih">Roadway Proving Ground</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                {[
                  ['concrete_wall', '🧱 Frontal Concrete Wall Impact'],
                  ['bollard_pole', '💈 Center Steel Bollard Pole'],
                  ['spike_strip', '📌 Road Spike Strip (Tire Blowout)'],
                  ['speed_bump', '⛰️ High-Speed Baja Speed-Bump Jump'],
                  ['wind_and_thrust', '🌪️ Crosswind Gale & Body-Roll Test'],
                  ['wind_tunnel', '💨 Bernoulli Wind Tunnel (Lift / Downforce)']
                ].map(([id, label]) => (
                  <button
                    key={id}
                    className={'btn' + (obstacle === id ? ' on' : '')}
                    style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                    onClick={() => setObstacle(id)}
                  >
                    {label}
                  </button>
                ))}
                <button
                  className="btn"
                  style={{ justifyContent: 'flex-start', opacity: 0.75, borderStyle: 'dashed' }}
                  onClick={() => { onClose(); onGoPricing && onGoPricing() }}
                >
                  🔒 Custom AI Obstacle Generator (Pro)
                </button>
              </div>

              <h4 className="ih">Simulation Parameters</h4>
              {obstacle !== 'wind_tunnel' && (
                <>
                  <div className="ir">
                    <span>Vehicle Speed</span>
                    <b>{speed} km/h</b>
                  </div>
                  <input type="range" min="15" max="220" value={speed} onChange={e => setSpeed(Number(e.target.value))} style={{ width: '100%' }} />
                </>
              )}

              <div className="ir" style={{ marginTop: 6 }}>
                <span>{obstacle === 'wind_tunnel' ? 'Wind Speed' : 'Crosswind Gust'}</span>
                <b>{wind} m/s{obstacle === 'wind_tunnel' ? ' · ' + Math.round(wind * 3.6) + ' km/h' : ''}</b>
              </div>
              <input type="range" min={obstacle === 'wind_tunnel' ? 0 : 10} max="150" value={wind} onChange={e => onWind(Number(e.target.value))} style={{ width: '100%' }} />

              {obstacle === 'wind_tunnel' && (
                <>
                  <div className="ir" style={{ marginTop: 6 }}>
                    <span>Wind Angle (yaw)</span>
                    <b>{yaw}°</b>
                  </div>
                  <input type="range" min="-90" max="90" value={yaw} onChange={e => onYaw(Number(e.target.value))} style={{ width: '100%' }} />
                  <div className="ir" style={{ marginTop: 6 }}>
                    <span>Wind Pitch (up / down)</span>
                    <b>{pitch}°</b>
                  </div>
                  <input type="range" min="-30" max="30" value={pitch} onChange={e => onPitch(Number(e.target.value))} style={{ width: '100%' }} />
                  <div className="eq" style={{ marginTop: 4 }}>Yaw is visible in the 3D flow view; pitch shows in both views.</div>
                </>
              )}

              <div className="ir" style={{ marginTop: 6 }}>
                <span>Primary Material</span>
                <select value={simMat} onChange={e => setSimMat(e.target.value)}>
                  {MATS.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>

              {s.mesh?.parts?.length > 0 && (
                <>
                  <h4 className="ih">Per-Part Color & Material</h4>
                  {s.mesh.parts.map((pname, idx) => {
                    const curHex = (partColors && partColors[pname]) || ['#ef4444', '#38bdf8', '#1e293b', '#94a3b8'][idx % 4]
                    return (
                      <div className="ir" key={pname} style={{ gap: 6 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="color"
                            value={curHex}
                            title={`Change color of ${pname}`}
                            onChange={e => setCustomColors(c => ({ ...c, [pname]: e.target.value }))}
                            style={{ width: 20, height: 20, padding: 0, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'none' }}
                          />
                          {pname}
                        </span>
                        <select
                          value={partMats[pname] || simMat}
                          onChange={e => setPartMats(p => ({ ...p, [pname]: e.target.value }))}
                        >
                          {MATS.map(m => <option key={m}>{m}</option>)}
                        </select>
                      </div>
                    )
                  })}
                </>
              )}

              <h4 className="ih">Visual Render Mode</h4>
              <div className="seg" style={{ marginBottom: 8 }}>
                <button className={!showHeatmap ? 'on' : ''} onClick={() => setShowHeatmap(false)}>
                  🎨 True Material Colors
                </button>
                <button className={showHeatmap ? 'on' : ''} onClick={() => setShowHeatmap(true)}>
                  🔥 FEA Stress Heatmap
                </button>
              </div>

              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button className="btn p" style={{ flex: 1 }} onClick={runCrashSim}>
                  {obstacle === 'wind_tunnel' ? '▶ Run Aero Simulation' : '▶ Run Simulation'}
                </button>
                <button
                  className={'btn' + (flipDirection ? ' on' : '')}
                  title="Flip Front/Rear Impact Direction"
                  onClick={() => setFlipDirection(f => !f)}
                >
                  ⇄ Flip Dir
                </button>
                {simAnim.active && (
                  <button className="btn" onClick={resetSim}>Reset</button>
                )}
              </div>

              {crash && !crash.skipped && (
                <>
                  <h4 className="ih">Edge-Case Telemetry</h4>
                  <div className="ir"><span>Status</span><b style={{ color: crash.survived ? '#10b981' : '#ef4444' }}>{crash.survived ? '✓ SURVIVED' : '⚠ PLASTIC FRACTURE'}</b></div>
                  {crash.failure_description && <div className="eq" style={{ marginBottom: 6 }}>{crash.failure_description}</div>}
                  <div className="ir"><span>Safety Factor</span><b>{physData.overall_safety_factor}×</b></div>
                  <div className="ir"><span>Peak Deceleration</span><b>{crash.peak_deceleration_g} G</b></div>
                  <div className="ir"><span>Crumple Depth</span><b>{crash.crumple_depth_mm} mm ({(crash.crumple_ratio * 100).toFixed(1)}%)</b></div>
                  <div className="ir"><span>Impact Energy</span><b>{crash.kinetic_energy_j} J</b></div>
                  <div className="ir"><span>Peak Stress</span><b>{crash.impact_stress_mpa} MPa</b></div>
                  {windTest && <div className="ir"><span>Wind Shear SF</span><b>{windTest.safety_factor}× ({windTest.bending_stress_mpa} MPa)</b></div>}
                  {buckTest && <div className="ir"><span>6G Buckling SF</span><b>{buckTest.safety_factor}×</b></div>}
                </>
              )}

              {aeroTest && (
                <>
                  <h4 className="ih">Bernoulli Aerodynamics</h4>
                  <div className="eq">
                    p + ½ρv² = const<br />
                    ΔP = ½ρ(v<sub>top</sub>² − v<sub>bot</sub>²)<br />
                    F = ΔP × A = {nf(aeroTest.delta_p_pa, 1)} Pa × {aeroTest.planform_area_m2} m²
                  </div>
                  <div className="ir"><span>Relative Flow V∞</span><b>{aeroTest.flow_velocity_m_s} m/s</b></div>
                  <div className="ir"><span>Dynamic Pressure q</span><b>{aeroTest.dynamic_pressure_pa} Pa</b></div>
                  <div className="ir"><span>v top / bottom</span><b>{aeroTest.v_top_m_s} / {aeroTest.v_bottom_m_s} m/s</b></div>
                  <div className="ir"><span>p top / bottom</span><b>{aeroTest.p_top_pa} / {aeroTest.p_bottom_pa} Pa</b></div>
                  <div className="ir"><span>Pressure Δ</span><b>{aeroTest.delta_p_pa} Pa</b></div>
                  <div className="ir">
                    <span>{aeroTest.lift_force_n < 0 ? 'Downforce' : 'Lift'}</span>
                    <b style={{ color: aeroTest.lift_force_n < 0 ? '#10b981' : '#f59e0b' }}>
                      {nf(Math.abs(aeroTest.lift_force_n), 1)} N {aeroTest.lift_force_n < 0 ? '⬇' : '⬆'}
                    </b>
                  </div>
                  <div className="ir"><span>Drag</span><b>{nf(aeroTest.drag_force_n, 1)} N</b></div>
                  <div className="ir"><span>Cl (effective)</span><b>{aeroTest.lift_coefficient}</b></div>
                  <div className="ir"><span>Lift / Weight</span><b>{aeroTest.lift_to_weight}×</b></div>
                  <div className="ir"><span>Reynolds · Mach</span><b>{nf(aeroTest.reynolds, 0)} · {aeroTest.mach}</b></div>
                  {aeroTest.mach > 0.3 && (
                    <div className="eq">Mach &gt; 0.3: incompressible Bernoulli is only approximate here.</div>
                  )}
                </>
              )}

              {physData?.part_breakdown?.length > 0 && (
                <>
                  <h4 className="ih">AI Material & Wastage Audit</h4>
                  {physData.part_breakdown.map(pb => (
                    <div key={pb.part_id} className="eq" style={{ marginBottom: 6 }}>
                      <b>{pb.part_id}</b> ({pb.material} · {fmtMass(pb.mass_g)} · SF {pb.safety_factor}×)<br />
                      <span>{pb.recommendation}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
        <div className="mf">
          <span>{simAnim.active ? 'Simulation Active · ' : ''}{measure ? 'Click two points to measure · ' : ''}Drag to rotate · Scroll or pinch to zoom · Esc to close</span>
          <span>{s.bbox ? fmtSize(s.bbox) : ''}</span>
        </div>
      </div>
    </div>
  )
}

/* ---------- App ---------- */
export default function App() {
  const [view, setView] = useState('chat')
  const [panel, setPanel] = useState('general')
  const [subOpen, setSubOpen] = useState(false)
  const pwRef = useRef(null)

  const [sbOff, setSbOff] = useState(() => {
    const v = readLS('bp-sb', null)
    return v === '0' || window.innerWidth <= 820
  })
  useEffect(() => { document.body.classList.toggle('sb-off', sbOff) }, [sbOff])
  const toggleSb = () => setSbOff(o => { writeLS('bp-sb', o ? '1' : '0'); return !o })
  const closeSbMobile = () => { if (window.innerWidth <= 820) setSbOff(true) }
  const go = v => { setView(v); closeSbMobile() }

  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleSb() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const [online, setOnline] = useState(null)
  useEffect(() => {
    let alive = true
    const ping = () => health().then(h => alive && setOnline(!!h.ok), () => alive && setOnline(false))
    ping()
    const t = setInterval(ping, 30000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const [theme, setTheme] = useState(() => readLS('bp-theme', 'dark'))
  const [accent, setAccent] = useState(ACCENTS[0])
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme:dark)')
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme
    }
    apply()
    writeLS('bp-theme', theme)
    if (theme === 'system') {
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [theme])
  useEffect(() => { document.documentElement.style.setProperty('--accent', accent) }, [accent])
  useEffect(() => {
    if (reduce) document.documentElement.style.setProperty('--e', 'linear')
    else document.documentElement.style.removeProperty('--e')
  }, [reduce])

  useEffect(() => {
    const onClick = e => { if (pwRef.current && !pwRef.current.contains(e.target)) setSubOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setSubOpen(false) }
    document.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const [userName, setUserName] = useState(() => readLS('bp-user', 'Gurtej'))
  useEffect(() => { writeLS('bp-user', userName) }, [userName])

  const [hist, setHist] = useState([])
  const [files, setFiles] = useState([])
  const [hs, setHs] = useState('')
  const [fs, setFs] = useState('')
  const [ff, setFf] = useState('All')

  const shownHist = hist.filter(h => h && String(h.t || '').toLowerCase().includes(hs.toLowerCase()))
  const shownFiles = files.filter(x => x && String(x.n || '').toLowerCase().includes(fs.toLowerCase()) && (ff === 'All' || x.f === ff))
  const verifiedCount = files.filter(x => x && x.verified).length
  const topFmt = (() => {
    const c = {}
    files.forEach(x => { if (x && x.f) c[x.f] = (c[x.f] || 0) + 1 })
    return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || 'STEP'
  })()

  const [inp, setInp] = useState('')
  const [model, setModel] = useState('Brepline-1')
  const [mat, setMat] = useState('Al 6061')
  const [fmt, setFmt] = useState('STEP')
  const [unit, setUnit] = useState('mm')
  const [optOpen, setOptOpen] = useState(false)
  const [refine, setRefine] = useState(null)
  const optRef = useRef(null)
  useEffect(() => {
    const onClick = e => { if (optRef.current && !optRef.current.contains(e.target)) setOptOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOptOpen(false) }
    document.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
  const inpRef = useRef(null)
  const msgsRef = useRef(null)
  const uid = useRef(0)
  const aborts = useRef({})

  const [toasts, setToasts] = useState([])
  const tid = useRef(0)
  const [cf, setCf] = useState(null)
  const closeCf = useCallback(() => setCf(null), [])
  const ask = o => setCf(o)
  const [notifOn, setNotifOn] = useState(() => readLS('bp-notif', '1') === '1')
  const notifRef = useRef(notifOn)
  useEffect(() => { notifRef.current = notifOn; writeLS('bp-notif', notifOn ? '1' : '0') }, [notifOn])
  const [unread, setUnread] = useState(false)
  useEffect(() => {
    const seen = () => { if (!document.hidden) setUnread(false) }
    document.addEventListener('visibilitychange', seen)
    window.addEventListener('focus', seen)
    return () => { document.removeEventListener('visibilitychange', seen); window.removeEventListener('focus', seen) }
  }, [])
  const askPerm = () => {
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission() } catch { /* ignore */ }
  }
  const pushToast = t => {
    const id = ++tid.current
    setToasts(p => [...p.slice(-2), { ...t, id }])
    setTimeout(() => setToasts(p => p.filter(x => x.id !== id)), 7000)
  }
  const announce = (kind, title, body, msgId) => {
    if (!notifRef.current) return
    pushToast({ kind, title, body, msgId })
    try {
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification(title, { body })
    } catch { /* ignore */ }
    if (document.hidden) setUnread(true)
  }

  const [chats, setChats] = useState([{ id: 1, msgs: [] }])
  const [activeId, setActiveId] = useState(1)
  const cid = useRef(1)
  const cur = chats.find(c => c.id === activeId) || chats[chats.length - 1] || { id: 1, msgs: [] }
  const msgs = cur.msgs || []
  const allMsgs = chats.flatMap(c => c.msgs || [])
  const setMsgs = fn => setChats(cs => cs.map(c => {
    const n = fn(c.msgs)
    return n.length === c.msgs.length && n.every((x, i) => x === c.msgs[i]) ? c : { ...c, msgs: n }
  }))
  const addMsg = M => setChats(cs => cs.map(c => (c.id === cur.id ? { ...c, msgs: [...c.msgs, M] } : c)))
  useEffect(() => { if (chats.length && !chats.some(c => c.id === activeId)) setActiveId(chats[chats.length - 1].id) }, [chats, activeId])

  useEffect(() => {
    msgsRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' })
  }, [msgs.length, activeId])

  const patch = (id, o) => setMsgs(p => p.map(x => (x.id === id ? { ...x, ...o } : x)))
  const busyList = allMsgs.filter(m => m.busy)
  const busyCount = busyList.length
  useEffect(() => {
    document.title = busyCount ? 'Generating… · BREPLINE' : unread ? '✓ Ready · BREPLINE' : 'BREPLINE — AI-native mechanical engineering'
  }, [busyCount, unread])

  const runGen = async (id, text, { m, f, parent = null, fresh = false }) => {
    const ac = new AbortController()
    aborts.current[id] = ac
    const t0 = Date.now()
    let lastLogs = []
    let lastVertCount = 0
    patch(id, { busy: true, err: null, stopped: false, logs: [], partialMesh: null, t0 })
    try {
      const r = await generate(
        { prompt: text, material: m, parentJob: parent, fresh },
        lines => {
          if (lines.length && (lines.length !== lastLogs.length || lines[lines.length - 1] !== lastLogs[lastLogs.length - 1])) {
            lastLogs = lines
            patch(id, { logs: lines })
          }
        },
        ac.signal,
        job => { ac.job = job },
        partialMesh => {
          if (partialMesh && partialMesh.verts && partialMesh.verts.length !== lastVertCount) {
            lastVertCount = partialMesh.verts.length
            patch(id, { partialMesh })
          }
        }
      )
      if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const secs = Math.round((Date.now() - t0) / 1000)
      const v = { ...toVersion(r, text, f, m), think: { logs: lastLogs, secs } }
      const fid = ++uid.current
      setMsgs(p => p.map(x => (x.id === id
        ? { ...x, vers: [...x.vers, v], cur: x.vers.length, vote: 0, busy: false, partialMesh: null, err: null, stopped: false }
        : x)))
      setFiles(fl => [{ fid, n: v.n, f, size: fmtSize(v.bbox), mass: fmtMass(v.mass_g), verified: v.verified, v }, ...fl])
      announce('ok', 'Model ready', `${v.title} · ${fmtSize(v.bbox)} · ${fmtMass(v.mass_g)}`, id)
    } catch (e) {
      const trace = { logs: lastLogs, secs: Math.round((Date.now() - t0) / 1000) }
      if (ac.signal.aborted || (e && e.name === 'AbortError')) {
        patch(id, { busy: false, stopped: true, err: null, trace })
      } else {
        patch(id, { busy: false, stopped: false, err: e.message || 'Generation failed', trace })
        announce('err', 'Generation failed', friendly(e.message), id)
      }
    } finally {
      delete aborts.current[id]
    }
  }

  const send = txt => {
    const t = (typeof txt === 'string' ? txt : inp).trim()
    if (!t || busyCount) return
    setInp('')
    if (inpRef.current) inpRef.current.style.height = 'auto'
    askPerm()
    const id = ++uid.current
    const parent = refine ? refine.job : null
    setRefine(null)
    const M = { id, text: t, f: fmt, m: mat, parent, vers: [], cur: 0, vote: 0, busy: true, editing: false, err: null, stopped: false, trace: null, logs: [], partialMesh: null, t0: Date.now() }
    addMsg(M)
    setHist(h => [{ id, t: t.slice(0, 42), d: 'Today', f: fmt }, ...h])
    runGen(id, t, { m: mat, f: fmt, parent })
  }

  const regen = (id, text) => {
    const M = msgs.find(x => x.id === id)
    if (!M || busyCount) return
    window.speechSynthesis && window.speechSynthesis.cancel()
    const forceFresh = Boolean(M.vers && M.vers.length > 0 && text === undefined)
    runGen(id, text ?? M.text, { m: M.m, f: M.f, parent: M.parent, fresh: forceFresh })
  }
  const saveEdit = (id, v) => {
    if (!v) return
    patch(id, { text: v, editing: false })
    regen(id, v)
  }
  const nav = (id, d) => setMsgs(p => p.map(x => (x.id === id ? { ...x, cur: Math.max(0, Math.min(x.vers.length - 1, x.cur + d)) } : x)))
  const vote = (id, val) => {
    const M = msgs.find(x => x.id === id)
    const v = M && M.vers[M.cur]
    const next = M && M.vote === val ? 0 : val
    setMsgs(p => p.map(x => (x.id === id ? { ...x, vote: next } : x)))
    if (v) sendVote(v.job, next === 1 ? 'up' : next === -1 ? 'down' : 'none')
  }
  const speak = M => {
    const s = window.speechSynthesis
    if (!s) return
    if (s.speaking) { s.cancel(); return }
    s.speak(new SpeechSynthesisUtterance(plain(M.vers[M.cur])))
  }
  const startRefine = v => {
    setRefine({ job: v.job, label: v.title })
    setView('chat')
    setTimeout(() => inpRef.current && inpRef.current.focus(), 0)
  }
  const newDesign = () => {
    window.speechSynthesis && window.speechSynthesis.cancel()
    if (msgs.length) {
      const empty = chats.find(c => !c.msgs.length)
      if (empty) setActiveId(empty.id)
      else { const id = ++cid.current; setChats(cs => [...cs, { id, msgs: [] }]); setActiveId(id) }
    }
    setInp('')
    setRefine(null)
    setView('chat')
    closeSbMobile()
  }
  const openChat = id => {
    window.speechSynthesis && window.speechSynthesis.cancel()
    setActiveId(id)
    setRefine(null)
    setView('chat')
    closeSbMobile()
  }

  const stopOne = id => {
    const ac = aborts.current[id]
    if (!ac) return
    ac.abort()
    if (ac.job) cancelJob(ac.job)
  }
  const stopAll = () => Object.keys(aborts.current).forEach(stopOne)
  const openTurn = id => {
    const c = chats.find(x => x.msgs.some(m => m.id === id))
    if (c) setActiveId(c.id)
    go('chat')
    setTimeout(() => document.getElementById('m-' + id)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 150)
  }
  const removeTurn = id => {
    stopOne(id)
    const M = allMsgs.find(x => x.id === id)
    const jobs = new Set(M ? M.vers.map(v => v.job) : [])
    setMsgs(p => p.filter(x => x.id !== id))
    setHist(h => h.filter(x => x && x.id !== id))
    setFiles(fl => fl.filter(x => x && x.v && !jobs.has(x.v.job)))
  }
  const askRemoveTurn = (id, label) => ask({
    title: 'Delete this design?',
    body: `"${label}" will be removed from the chat, history and generated files of this session.`,
    ok: 'Delete', danger: true, run: () => removeTurn(id)
  })
  const removeChat = c => {
    c.msgs.forEach(m => stopOne(m.id))
    const ids = new Set(c.msgs.map(m => m.id))
    const jobs = new Set(c.msgs.flatMap(m => m.vers.map(v => v.job)))
    const nid = ++cid.current
    setHist(h => h.filter(x => x && !ids.has(x.id)))
    setFiles(fl => fl.filter(x => x && x.v && !jobs.has(x.v.job)))
    setChats(cs => { const r = cs.filter(x => x.id !== c.id); return r.length ? r : [{ id: nid, msgs: [] }] })
  }
  const askRemoveChat = c => ask({
    title: 'Delete this chat?',
    body: `"${c.msgs[0].text.slice(0, 42)}"${c.msgs.length > 1 ? ` and its ${c.msgs.length} designs` : ''} will be removed from this session.`,
    ok: 'Delete', danger: true, run: () => removeChat(c)
  })
  const askRemoveFile = x => ask({
    title: 'Delete this file?',
    body: `${x.n}.${x.f.toLowerCase()} will be removed from your generated files.`,
    ok: 'Delete', danger: true, run: () => setFiles(fl => fl.filter(y => y && y.fid !== x.fid))
  })

  const [shapeEd, setShapeEd] = useState({ open: false, initial: null, parent: null })
  const drawShape = () => setShapeEd({ open: true, initial: null, parent: null })
  const editShape = v => setShapeEd({ open: true, initial: v.shape, parent: v.job })
  const closeShape = useCallback(() => setShapeEd(s => ({ ...s, open: false })), [])
  const addShapeResult = (r, spec, name) => {
    const label = name || (spec.type === 'polygon' ? 'Custom polygon part' : 'Custom revolved part')
    const id = ++uid.current
    const v = toVersion(r, label, fmt, mat)
    addMsg({ id, text: label, f: fmt, m: mat, parent: shapeEd.parent, vers: [v], cur: 0, vote: 0, busy: false, editing: false, err: null, logs: [], partialMesh: null, t0: Date.now() })
    setHist(h => [{ id, t: label.slice(0, 42), d: 'Today', f: fmt }, ...h])
    setFiles(fl => [{ fid: ++uid.current, n: v.n, f: fmt, size: fmtSize(v.bbox), mass: fmtMass(v.mass_g), verified: v.verified, v }, ...fl])
    setView('chat')
  }

  const [v3, setV3] = useState({ open: false, job: '', name: 'part', f: 'STEP', mesh: null, bbox: null, info: null })
  const open3d = v => setV3({ open: true, job: v.job, name: v.title || v.n, f: v.f, mesh: v.mesh, bbox: v.bbox, info: v })
  const close3d = useCallback(() => setV3(s => ({ ...s, open: false })), [])

  const [upb, setUpb] = useState(true)

  useEffect(() => {
    fetchHistory().then(res => {
      if (!res || !res.ok || !Array.isArray(res.items) || !res.items.length) return
      const dbMsgs = []
      const dbHist = []
      const dbFiles = []
      res.items.slice().reverse().forEach(r => {
        if (!r || !r.mesh || !r.mesh.verts) return
        const id = ++uid.current
        const promptText = String(r.prompt || (r.plan && r.plan.object) || 'CAD Design')
        const matName = r.material || 'Al 6061'
        const v = toVersion(r, promptText, 'STEP', matName)
        dbMsgs.push({
          id, text: promptText, f: 'STEP', m: matName, parent: null,
          vers: [v], cur: 0, vote: 0, busy: false, editing: false,
          err: null, stopped: false, trace: null, logs: ['Restored from Supabase'], partialMesh: null, t0: Date.now()
        })
        dbHist.unshift({ id, t: promptText.slice(0, 42), d: 'Saved in DB', f: 'STEP' })
        dbFiles.unshift({ fid: ++uid.current, n: v.n, f: 'STEP', size: fmtSize(v.bbox), mass: fmtMass(v.mass_g), verified: v.verified, v })
      })
      if (dbMsgs.length) {
        setChats([{ id: 1, msgs: dbMsgs }])
        setHist(dbHist)
        setFiles(dbFiles)
      }
    }).catch(() => {})
  }, [])

  return (
    <>
      <Sprite />

      <aside>
        <div className="brand">
          <div className="logo"><Ic n="cube" /></div>BREPLINE
          <button className="sclose" title="Close menu" aria-label="Close menu" onClick={() => setSbOff(true)}>
            <svg className="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <button className="new" onClick={newDesign}><Ic n="plus" />New design</button>
        <nav>
          {NAV.map(([v, label, icon]) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => go(v)}><Ic n={icon} />{label}{v === 'chat' && busyCount > 0 && <span className="nb" title="Generating">{busyCount}</span>}</button>
          ))}
        </nav>
        <SidebarGen items={busyList} onStop={stopAll} onOpen={openTurn} />
        <div className="cap">Recent</div>
        <div className="rlist">
          {chats.filter(c => c.msgs && c.msgs.length).slice().reverse().slice(0, 10).map(c => (
            <div key={c.id} className={'ri' + (c.id === cur.id && view === 'chat' ? ' on' : '')} onClick={() => openChat(c.id)} title={c.msgs[0].text}>
              {c.msgs.some(m => m.busy) && <i className="sgd" title="Generating" />}
              <span className="rt">{c.msgs[0].text.slice(0, 42)}</span>
              <button className="rx" title="Delete chat" aria-label="Delete chat" onClick={e => { e.stopPropagation(); askRemoveChat(c) }}><PI k="x" /></button>
            </div>
          ))}
        </div>
        <div className="pw" ref={pwRef}>
          <nav className="bnav">
            <button className={view === 'settings' ? 'on' : ''} onClick={e => { e.stopPropagation(); setSubOpen(o => !o) }}>
              <Ic n="gear" />Settings
            </button>
          </nav>
          <div className={'sub' + (subOpen ? ' open' : '')}>
            {SUB.map(([id, label]) => (
              <button
                key={id}
                className={panel === id ? 'on' : ''}
                onClick={() => { setView('settings'); setPanel(id); setSubOpen(false); closeSbMobile() }}
              >{label}</button>
            ))}
          </div>
        </div>
        <div className="user" onClick={() => go('settings')}>
          <div className="av">{String(userName || 'G')[0].toUpperCase()}</div>
          <div>{userName}<small>Free plan</small></div>
        </div>
      </aside>
      <div className="scrim" onClick={() => setSbOff(true)} />

      <main>
        <header>
          <div className="hl">
            <button className="btn sbt" title="Toggle sidebar (Ctrl+B)" aria-label="Toggle sidebar" onClick={toggleSb}><Ic n="side" /></button>
            <select id="model" value={model} onChange={e => setModel(e.target.value)}>
              <option>Brepline-1</option>
            </select>
          </div>
          {upb && (
            <div className="upb">
              <span>Free plan</span><i>&middot;</i>
              <button className="ul" onClick={() => go('pricing')}>Upgrade</button>
              <button className="upx" title="Dismiss" aria-label="Dismiss" onClick={() => setUpb(false)}>
                <svg className="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
          )}
          <span className="pill">{online === null ? 'Connecting…' : online ? 'Engine online' : 'Engine offline'}</span>
        </header>

        {/* CHAT */}
        <section className={'view' + (view === 'chat' ? ' on' : '')} id="chat">
          <div id="msgs" ref={msgsRef}>
            <div className="wrap" id="feed">
              {msgs.length === 0 && (
                <div className="hero">
                  <h1>What shall we <span>build</span> today?</h1>
                  <p>Describe a part or vehicle. Receive multi-part 3D CAD & live physics stress simulations.</p>
                  <div className="chips">
                    {CHIPS.map(([k, t]) => (
                      <button key={k} className="chip" onClick={() => send(t)}><b>{k}</b>{t}</button>
                    ))}
                  </div>
                </div>
              )}
              {msgs.map(M => {
                const v = M.vers && M.vers[M.cur]
                const loading = M.busy
                return (
                  <Fragment key={M.id}>
                    <div className="m u" id={'m-' + M.id}>
                      <div className="ic">{String(userName || 'G')[0].toUpperCase()}</div>
                      <div className="t">
                        {M.editing ? (
                          <EditBox init={M.text} onSave={val => saveEdit(M.id, val)} onCancel={() => patch(M.id, { editing: false })} />
                        ) : (
                          <>
                            <div className="ut">{M.text}</div>
                            <div className="tb">
                              <CopyBtn text={M.text} />
                              <button title="Edit" onClick={() => patch(M.id, { editing: true })}><PI k="pen" /></button>
                              <button title="Delete" aria-label="Delete" onClick={() => askRemoveTurn(M.id, M.text.slice(0, 42))}><PI k="x" /></button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="m a">
                      <div className="ic">B</div>
                      <div className="t">
                        <div className="body">
                          {loading ? (
                            <>
                              <Thinking state="busy" logs={M.logs} t0={M.t0} partialMesh={null} onStop={() => stopOne(M.id)} />
                              {M.partialMesh && M.partialMesh.verts && M.partialMesh.verts.length > 0 && (
                                <div className="cad" style={{ marginTop: 10, borderStyle: 'dashed' }}>
                                  <div
                                    className="prev"
                                    onClick={() => open3d({
                                      job: M.id,
                                      title: `${M.text.slice(0, 32)} (Building live…)`,
                                      n: fname(M.text),
                                      f: M.f,
                                      m: M.m,
                                      mesh: M.partialMesh,
                                      bbox: [0, 0, 0],
                                      mass_g: 0
                                    })}
                                  >
                                    <Thumb mesh={M.partialMesh} alt="Live assembly progress" />
                                  </div>
                                  <div className="meta">
                                    <div><small>Status</small>Compiling sub-parts…</div>
                                    <div><small>Components</small>{(M.partialMesh.parts && M.partialMesh.parts.length) || 1} built</div>
                                    <div><small>Preview</small>Interactive 3D Ready</div>
                                  </div>
                                  <div className="acts">
                                    <button
                                      className="btn p"
                                      onClick={() => open3d({
                                        job: M.id,
                                        title: `${M.text.slice(0, 32)} (Building live…)`,
                                        n: fname(M.text),
                                        f: M.f,
                                        m: M.m,
                                        mesh: M.partialMesh,
                                        bbox: [0, 0, 0],
                                        mass_g: 0
                                      })}
                                    >
                                      <Ic n="exp" />Open Live 3D Playground
                                    </button>
                                  </div>
                                </div>
                              )}
                            </>
                          ) : v ? (
                            <>
                              <Thinking state="done" logs={v.think && v.think.logs} secs={v.think && v.think.secs} />
                              <Result v={v} onOpen3d={open3d} onRefine={startRefine} onEditShape={editShape} />
                            </>
                          ) : (
                            <>
                              <Thinking state={M.stopped ? 'stopped' : 'error'} logs={M.trace && M.trace.logs} secs={M.trace && M.trace.secs} />
                              <div className={'errc' + (M.stopped ? ' stp' : '')}>
                                <b>{M.stopped ? 'Generation stopped' : "Couldn't build this part"}</b>
                                <span title={M.err || ''}>{M.stopped ? 'You stopped this request before it finished. Nothing was added.' : friendly(M.err)}</span>
                                <button className="btn" disabled={busyCount > 0} onClick={() => regen(M.id)}>Try again</button>
                              </div>
                            </>
                          )}
                          {!loading && v && M.stopped && <div style={{ fontSize: 13, opacity: 0.7, marginTop: 6 }}>Regeneration stopped. Showing the previous version.</div>}
                          {!loading && v && M.err && <div style={{ fontSize: 13, opacity: 0.7, marginTop: 6 }}>Last retry failed: {friendly(M.err)}</div>}
                        </div>
                        <div className="tbw">
                          {!loading && (
                            <div className="tb">
                              {M.vers && M.vers.length > 1 && (
                                <span className="pg">
                                  <button disabled={!M.cur} onClick={() => nav(M.id, -1)}><PI k="l" /></button>
                                  {M.cur + 1} / {M.vers.length}
                                  <button disabled={M.cur >= M.vers.length - 1} onClick={() => nav(M.id, 1)}><PI k="r" /></button>
                                </span>
                              )}
                              {v && <CopyBtn text={plain(v)} />}
                              {v && <button title="Read aloud" onClick={() => speak(M)}><PI k="spk" /></button>}
                              {v && <button title="Good response" className={M.vote === 1 ? 'on' : ''} onClick={() => vote(M.id, 1)}><PI k="tu" /></button>}
                              {v && <button title="Bad response" className={M.vote === -1 ? 'on' : ''} onClick={() => vote(M.id, -1)}><PI k="td" /></button>}
                              <button title="Regenerate" disabled={busyCount > 0} onClick={() => regen(M.id)}><PI k="redo" /></button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </Fragment>
                )
              })}
            </div>
          </div>
          <div className="comp">
            <div className="box">
              {refine && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 2px', opacity: 0.8 }}>
                  <span>Editing: {refine.label}</span>
                  <button className="btn" style={{ padding: '0 8px' }} onClick={() => setRefine(null)}>Cancel</button>
                </div>
              )}
              <textarea
                id="inp"
                ref={inpRef}
                rows={1}
                value={inp}
                placeholder={busyCount ? 'Generating… press Stop to cancel' : refine ? 'Describe the change, e.g. make the holes 8 mm' : 'Describe the part and its dimensions in mm'}
                onChange={e => setInp(e.target.value)}
                onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px' }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              />
              <div className="bar">
                <button className="btn" title="Draw your own polygon or profile" aria-label="Draw shape" onClick={drawShape}><Ic n="clip" /><span className="lbl">Draw shape</span></button>
                <div className="opts-d">
                  <select value={mat} onChange={e => setMat(e.target.value)}>{MATS.map(x => <option key={x}>{x}</option>)}</select>
                  <select value={fmt} onChange={e => setFmt(e.target.value)}>{FMTS.map(x => <option key={x}>{x}</option>)}</select>
                  <select value={unit} onChange={e => setUnit(e.target.value)}><option>mm</option></select>
                </div>
                <div className="optw" ref={optRef}>
                  <button className="btn optb" aria-expanded={optOpen} onClick={() => setOptOpen(o => !o)}>
                    <span className="optt">{mat} · {fmt} · {unit}</span>
                    <svg className="i" viewBox="0 0 24 24" style={{ transform: optOpen ? 'rotate(180deg)' : 'none' }}><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                  {optOpen && (
                    <div className="optp">
                      <label><small>Material</small>
                        <select value={mat} onChange={e => setMat(e.target.value)}>{MATS.map(x => <option key={x}>{x}</option>)}</select></label>
                      <label><small>Export format</small>
                        <select value={fmt} onChange={e => setFmt(e.target.value)}>{FMTS.map(x => <option key={x}>{x}</option>)}</select></label>
                      <label><small>Units</small>
                        <select value={unit} onChange={e => setUnit(e.target.value)}><option>mm</option></select></label>
                    </div>
                  )}
                </div>
                <span className="sp" />
                {busyCount
                  ? <button className="send stop" aria-label="Stop generating" title="Stop generating" onClick={stopAll}><PI k="stop" /></button>
                  : <button className="send" aria-label="Send" onClick={() => send()}><Ic n="up" /></button>}
              </div>
            </div>
            <div className="foot">BREPLINE can make mistakes. Verify dimensions before manufacturing.</div>
          </div>
        </section>

        {/* HISTORY */}
        <section className={'view' + (view === 'hist' ? ' on' : '')} id="hist">
          <div className="page">
            <h2>History</h2><p>Designs from this session & Supabase database.</p>
            <div className="tools"><input type="search" placeholder="Search history" value={hs} onChange={e => setHs(e.target.value)} /></div>
            <div>
              {shownHist.length ? shownHist.map(h => (
                <div key={h.id} className="hrow" onClick={() => openTurn(h.id)}>
                  <div><b>{h.t}</b><small>{busyList.some(m => m.id === h.id) ? 'Generating…' : h.d}</small></div>
                  <span className="tag">{h.f}</span>
                  <button className="hx" title="Delete" aria-label="Delete" onClick={e => { e.stopPropagation(); askRemoveTurn(h.id, h.t) }}><PI k="x" /></button>
                </div>
              )) : <p style={{ color: 'var(--mute)' }}>No conversations yet.</p>}
            </div>
          </div>
        </section>

        {/* FILES */}
        <section className={'view' + (view === 'files' ? ' on' : '')} id="files">
          <div className="page">
            <h2>Generated files</h2><p>CAD models persisted in Supabase.</p>
            <div className="stats">
              <div className="stat"><b>{files.length}</b>Models generated</div>
              <div className="stat"><b>{verifiedCount}</b>Verified models</div>
              <div className="stat"><b>{topFmt}</b>Most used format</div>
            </div>
            <div className="tools">
              <input type="search" placeholder="Search files" value={fs} onChange={e => setFs(e.target.value)} />
              <select value={ff} onChange={e => setFf(e.target.value)}><option>All</option><option>STEP</option><option>STL</option></select>
            </div>
            <div className="grid">
              {shownFiles.map(x => (
                <div className="f" key={x.fid}>
                  <button className="fx" title="Delete" aria-label="Delete file" onClick={() => askRemoveFile(x)}><PI k="x" /></button>
                  <div className="prev" onClick={() => open3d(x.v)}>
                    {x.v && x.v.mesh ? <Thumb mesh={x.v.mesh} alt={x.n} partColors={x.v.physics && x.v.physics.part_colors} /> : <PartIcon />}
                  </div>
                  <div className="in">
                    <b>{x.n}.{String(x.f || 'step').toLowerCase()}</b>
                    <small>{x.size} / {x.mass}</small>
                    <div className="row">
                      <span className="tag">{x.f}</span>
                      <span style={{ display: 'flex', gap: 6 }}>
                        <button className="btn" title="View in 3D" onClick={() => open3d(x.v)}><Ic n="exp" />3D</button>
                        <button className="btn" title="Download" onClick={() => dl(x.v.job, x.f)}><Ic n="dl" /></button>
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {!shownFiles.length && <p style={{ color: 'var(--mute)' }}>Nothing generated yet.</p>}
          </div>
        </section>

        {/* PRICING */}
        <PricingView active={view === 'pricing'} />

        {/* SETTINGS */}
        <section className={'view' + (view === 'settings' ? ' on' : '')} id="settings">
          <div className="set">
            <div className="sbody">
              <div className={'panel' + (panel === 'general' ? ' on' : '')}>
                <h3>General</h3><p>Basic workspace preferences.</p>
                <div className="srow"><div><b>Language</b><small>Interface language</small></div>
                  <select><option>English</option><option>Hindi</option><option>Punjabi</option></select></div>
                <div className="srow"><div><b>Send with Enter</b><small>Use Shift+Enter for a new line</small></div><Sw def /></div>
                <div className="srow"><div><b>Show example prompts</b><small>Display suggestions on the start screen</small></div><Sw def /></div>
              </div>

              <div className={'panel' + (panel === 'appearance' ? ' on' : '')}>
                <h3>Appearance</h3><p>Choose how BREPLINE looks.</p>
                <div className="srow"><div><b>Theme</b><small>Light, black, or follow your system</small></div>
                  <div className="seg">
                    {[['light', 'Light'], ['dark', 'Black'], ['system', 'System']].map(([t, l]) => (
                      <button key={t} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>{l}</button>
                    ))}
                  </div></div>
                <div className="srow"><div><b>Accent colour</b><small>Used for buttons and highlights</small></div>
                  <div className="swatches">
                    {ACCENTS.map(c => (
                      <button key={c} aria-label={c} className={accent === c ? 'on' : ''} style={{ background: c }} onClick={() => setAccent(c)} />
                    ))}
                  </div></div>
                <div className="srow"><div><b>Reduce motion</b><small>Turn off animations</small></div><Sw onChange={setReduce} /></div>
              </div>

              <div className={'panel' + (panel === 'model' ? ' on' : '')}>
                <h3>Model defaults</h3><p>Applied to every new design.</p>
                <div className="srow"><div><b>Default material</b><small>Used for the mass estimate</small></div>
                  <select value={mat} onChange={e => setMat(e.target.value)}>{MATS.map(x => <option key={x}>{x}</option>)}</select></div>
                <div className="srow"><div><b>Export format</b><small>Default file type</small></div>
                  <select value={fmt} onChange={e => setFmt(e.target.value)}>{FMTS.map(x => <option key={x}>{x}</option>)}</select></div>
                <div className="srow"><div><b>Units</b><small>All dimensions are in millimetres</small></div><Seg items={['mm']} /></div>
              </div>

              <div className={'panel' + (panel === 'notif' ? ' on' : '')}>
                <h3>Notifications</h3><p>Choose what you hear about.</p>
                <div className="srow"><div><b>Generation complete</b><small>Notify when a model is ready</small></div><Sw def={notifOn} onChange={v => { setNotifOn(v); if (v) askPerm() }} /></div>
                <div className="srow"><div><b>Product updates</b><small>New models and features by email</small></div><Sw /></div>
              </div>

              <div className={'panel' + (panel === 'data' ? ' on' : '')}>
                <h3>Data controls</h3><p>Manage what BREPLINE stores.</p>
                <div className="srow"><div><b>Model improvement</b><small>Prompts and generated designs are stored to train future versions</small></div><span className="tag">On</span></div>
                <div className="srow"><div><b>Clear history</b><small>Remove this session&apos;s conversations from the list</small></div>
                  <button className="btn danger" disabled={!hist.length} onClick={() => ask({
                    title: 'Clear history?', body: 'This clears the list of past prompts. Your open chat and generated files are not deleted.',
                    ok: 'Clear history', danger: true, run: () => setHist([]) })}>Clear</button></div>
              </div>

              <div className={'panel' + (panel === 'account' ? ' on' : '')}>
                <h3>Account</h3><p>Your profile and plan.</p>
                <div className="srow"><div><b>Name</b><small>Shown in the sidebar</small></div><input type="text" value={userName} onChange={e => setUserName(e.target.value)} /></div>
                <div className="srow"><div><b>Plan</b><small>Free plan</small></div>
                  <button className="btn p" onClick={() => go('pricing')}>Upgrade</button></div>
                <div className="srow"><div><b>Sign out</b><small>End this session</small></div><button className="btn">Sign out</button></div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <MeshModal s={v3} onClose={close3d} onGoPricing={() => go('pricing')} />
      <ShapeEditor open={shapeEd.open} initial={shapeEd.initial} material={mat} parentJob={shapeEd.parent} onClose={closeShape} onResult={addShapeResult} />
      <Toasts list={toasts} onClose={id => setToasts(p => p.filter(x => x.id !== id))}
        onOpen={t => { setToasts(p => p.filter(x => x.id !== t.id)); openTurn(t.msgId) }} />
      <Confirm cf={cf} onClose={closeCf} />
    </>
  )
}

function PricingView({ active }) {
  const [yearly, setYearly] = useState(false)
  const price = (m, y) => '$' + (yearly ? y : m)
  return (
    <section className={'view' + (active ? ' on' : '')} id="pricing">
      <div className="page">
        <h2>Pricing</h2><p>Start free. Upgrade when you need more generations and team features.</p>
        <Seg className="bill" items={['Monthly', 'Yearly · save 20%']} onPick={k => setYearly(k === 1)} />
        <div className="plans">
          <div className="plan">
            <h4>Free</h4>
            <div className="pr">$0<small> /month</small></div><small>For trying BREPLINE</small>
            <ul><li>Limited generations per day</li><li>STEP and STL export</li><li>Community support</li></ul>
            <button className="btn">Current plan</button>
          </div>
          <div className="plan hot">
            <h4>Pro <span className="tag">POPULAR</span></h4>
            <div className="pr"><span className="amt">{price(29, 23)}</span><small> /month</small></div><small>For engineers and makers</small>
            <ul><li>Unlimited generations</li><li>Custom AI obstacle simulation</li><li>Priority queue</li></ul>
            <button className="btn p">Upgrade to Pro</button>
          </div>
          <div className="plan">
            <h4>Team</h4>
            <div className="pr"><span className="amt">{price(79, 63)}</span><small> /seat/month</small></div><small>For companies and labs</small>
            <ul><li>Everything in Pro</li><li>Shared workspaces</li><li>API access</li><li>SSO and dedicated support</li></ul>
            <button className="btn">Contact sales</button>
          </div>
        </div>
      </div>
    </section>
  )
}