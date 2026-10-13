import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildShape, validateShape } from './api.js'

/*
  ShapeEditor - draw your own polygon (extrude) or half-section (revolve) and turn it into a
  real solid. The backend builds exactly what you draw, no AI involved.

  <ShapeEditor open initial={spec|null} material="Al 6061" parentJob={job|null}
               onClose={() => ...} onResult={(result, spec, name) => ...} />

  `initial` is the plan.profile_spec the backend returns for polygon / revolve designs, so the
  same editor re-opens any such design for editing.
*/

const r3 = v => Math.round(v * 1000) / 1000
const nice = x => {
  const p = Math.pow(10, Math.floor(Math.log10(x)))
  const m = x / p
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p
}

const star = (n, ro, ri) =>
  Array.from({ length: 2 * n }, (_, i) => {
    const r = i % 2 ? ri : ro
    const a = Math.PI / 2 + (i * Math.PI) / n
    return [r3(r * Math.cos(a)), r3(r * Math.sin(a))]
  })
const ngon = (n, r, rot = 0) =>
  Array.from({ length: n }, (_, i) => {
    const a = rot + (2 * Math.PI * i) / n
    return [r3(r * Math.cos(a)), r3(r * Math.sin(a))]
  })

const PRESETS = {
  polygon: {
    Rectangle: () => ({ pts: [[0, 0], [60, 0], [60, 40], [0, 40]], t: 5 }),
    'L shape': () => ({ pts: [[0, 0], [60, 0], [60, 10], [10, 10], [10, 40], [0, 40]], t: 5 }),
    Hexagon: () => ({ pts: ngon(6, 25), t: 6 }),
    Pentagon: () => ({ pts: ngon(5, 25, Math.PI / 2), t: 6 }),
    Star: () => ({ pts: star(5, 30, 12), t: 4 }),
    Triangle: () => ({ pts: [[0, 0], [50, 0], [25, 43.3]], t: 5 }),
    Arrow: () => ({ pts: [[0, 10], [40, 10], [40, 0], [70, 20], [40, 40], [40, 30], [0, 30]], t: 5 }),
    'Circle (24 sides)': () => ({ pts: ngon(24, 25), t: 5 })
  },
  revolve: {
    Cylinder: () => ({ pts: [[0, 0], [20, 0], [20, 50], [0, 50]] }),
    Cone: () => ({ pts: [[0, 0], [25, 0], [0, 60]] }),
    Vase: () => ({ pts: [[0, 0], [20, 0], [26, 30], [18, 70], [12, 95], [16, 110], [14, 110], [10, 95], [16, 70], [24, 30], [18, 3], [0, 3]] }),
    Bottle: () => ({ pts: [[0, 0], [25, 0], [25, 110], [12, 140], [8, 150], [8, 165], [0, 165]] }),
    Pulley: () => ({ pts: [[5, 0], [30, 0], [30, 6], [26, 10], [30, 14], [30, 20], [5, 20]] }),
    Rocket: () => ({
      pts: [[0, 0], [9, 0], [12, 12], [20, 22], [20, 140], [19.2, 152], [17.2, 166], [13.8, 180], [8.8, 192], [0, 200]],
      radial: [{ count: 4, polygon: [[20, 60], [20, 15], [42, 0], [42, 22]], thickness: 2 }]
    })
  }
}

function Num({ value, onChange, className, title }) {
  const [t, setT] = useState(String(r3(value)))
  const foc = useRef(false)
  useEffect(() => { if (!foc.current) setT(String(r3(value))) }, [value])
  return (
    <input
      className={className}
      title={title}
      type="text"
      inputMode="decimal"
      value={t}
      onFocus={e => { foc.current = true; e.target.select() }}
      onBlur={() => { foc.current = false; setT(String(r3(value))) }}
      onChange={e => {
        setT(e.target.value)
        const n = parseFloat(e.target.value.replace(',', '.'))
        if (Number.isFinite(n)) onChange(n)
      }}
    />
  )
}

const CSS = `
.se-wrap{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:2vh 2vw}
.se{background:var(--card,#fff);color:var(--tx,#0f1f3d);border:1px solid var(--line,#e3ded4);width:min(1080px,100%);max-height:96vh;display:flex;flex-direction:column;overflow:hidden;font-size:13px}
.se *{box-sizing:border-box}
.se-h{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line,#e3ded4)}
.se-h b{font-size:15px}.se-h small{color:var(--mute,#6b7488)}
.se-x{margin-left:auto}
.se-b{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(280px,1fr);gap:0;min-height:0;flex:1;overflow:hidden}
.se-l{padding:12px 16px;display:flex;flex-direction:column;gap:8px;min-width:0;overflow:auto}
.se-r{padding:12px 16px;border-left:1px solid var(--line,#e3ded4);overflow:auto;display:flex;flex-direction:column;gap:10px;min-height:0}
.se-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.se-bar select,.se-in,.se-n{background:var(--bg,#faf8f5);color:var(--tx,#0f1f3d);border:1px solid var(--line,#e3ded4);padding:6px 8px;font:inherit;min-width:0}
.se-bar .btn{padding:6px 10px}
.se-cv{position:relative;width:100%;aspect-ratio:4/3;background:var(--bg,#faf8f5);border:1px solid var(--line,#e3ded4);touch-action:none;user-select:none;cursor:crosshair;overflow:hidden}
.se-cv svg{position:absolute;inset:0;width:100%;height:100%;display:block}
.se-hint{color:var(--mute,#6b7488);font-size:12px;line-height:1.4}
.se-st{min-height:20px;font-size:12.5px}
.se-st.err{color:#d93025}.se-st.ok{color:var(--mute,#6b7488)}
.se-sec{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute,#6b7488);margin-top:2px}
.se-row{display:grid;grid-template-columns:22px 1fr 1fr 26px;gap:6px;align-items:center}
.se-row.h{grid-template-columns:22px 1fr 1fr 1fr 26px}
.se-row span{color:var(--mute,#6b7488);font-size:11px;text-align:right}
.se-n{width:100%;padding:5px 6px}
.se-row .btn{padding:2px 0;justify-content:center;width:26px;height:26px}
.se-list{display:flex;flex-direction:column;gap:5px;max-height:220px;overflow:auto;padding-right:2px}
.se-f{display:flex;gap:8px;align-items:center;padding:12px 16px;border-top:1px solid var(--line,#e3ded4)}
.se-f .sp{flex:1}
@media (max-width:820px){.se-b{grid-template-columns:1fr;overflow:auto}.se-r{border-left:0;border-top:1px solid var(--line,#e3ded4);overflow:visible}.se-l{overflow:visible}}
`

export default function ShapeEditor({ open, initial, material = 'Al 6061', parentJob = null, onClose, onResult }) {
  const [mode, setMode] = useState('polygon')
  const [pts, setPts] = useState(PRESETS.polygon.Rectangle().pts)
  const [thick, setThick] = useState(5)
  const [holes, setHoles] = useState([])
  const [extra, setExtra] = useState({}) // cutouts / radial fins we keep but do not edit
  const [name, setName] = useState('')
  const [snap, setSnap] = useState(1)
  const [tool, setTool] = useState('point')
  const [sel, setSel] = useState(null)
  const [view, setView] = useState({ cx: 30, cy: 20, span: 70 })
  const [stat, setStat] = useState({ ok: false, error: '' })
  const [busy, setBusy] = useState(false)
  const [logs, setLogs] = useState([])
  const [err, setErr] = useState('')
  const svgRef = useRef(null)
  const drag = useRef(null)
  const viewRef = useRef(view)
  viewRef.current = view

  const fitTo = useCallback((points, hs = [], md = mode) => {
    const xs = points.map(p => p[0]).concat(hs.map(h => h.x - h.d / 2), hs.map(h => h.x + h.d / 2))
    const ys = points.map(p => p[1]).concat(hs.map(h => h.y - h.d / 2), hs.map(h => h.y + h.d / 2))
    if (md === 'revolve') xs.push(-Math.max(...points.map(p => p[0]), 1))
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
    const w = Math.max(x1 - x0, 1), h = Math.max(y1 - y0, 1)
    setView({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, span: Math.max(h * 1.35, (w * 1.35) * 0.75, 10) })
  }, [mode])

  // load whenever the editor opens
  useEffect(() => {
    if (!open) return
    setErr(''); setLogs([]); setBusy(false); setSel(null); setTool('point')
    if (initial && initial.type === 'revolve') {
      setMode('revolve'); setPts(initial.profile.map(p => [...p])); setHoles([])
      setExtra({ radial: initial.radial || [] }); setThick(5)
      fitTo(initial.profile, [], 'revolve')
    } else if (initial && initial.type === 'polygon') {
      setMode('polygon'); setPts(initial.points.map(p => [...p])); setThick(initial.thickness || 5)
      setHoles((initial.holes || []).map(h => ({ ...h }))); setExtra({ cutouts: initial.cutouts || [] })
      fitTo(initial.points, initial.holes || [], 'polygon')
    } else {
      const p = PRESETS.polygon.Rectangle()
      setMode('polygon'); setPts(p.pts); setThick(p.t); setHoles([]); setExtra({})
      fitTo(p.pts, [], 'polygon')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const spec = useMemo(() => (
    mode === 'polygon'
      ? { type: 'polygon', points: pts.map(p => [r3(p[0]), r3(p[1])]), thickness: r3(thick), holes: holes.map(h => ({ x: r3(h.x), y: r3(h.y), d: r3(h.d) })), ...(extra.cutouts && extra.cutouts.length ? { cutouts: extra.cutouts } : {}) }
      : { type: 'revolve', profile: pts.map(p => [r3(Math.max(0, p[0])), r3(p[1])]), ...(extra.radial && extra.radial.length ? { radial: extra.radial } : {}) }
  ), [mode, pts, thick, holes, extra])

  // live validation on the server (pure python, instant)
  useEffect(() => {
    if (!open) return
    if (pts.length < 3) { setStat({ ok: false, error: 'Add at least 3 points.' }); return }
    const ac = new AbortController()
    const t = setTimeout(() => {
      validateShape(spec, ac.signal).then(r => setStat(r.ok ? r : { ok: false, error: r.error || 'Invalid shape' }), e => {
        if (e.name !== 'AbortError') setStat({ ok: true, offline: true })
      })
    }, 300)
    return () => { clearTimeout(t); ac.abort() }
  }, [open, spec, pts.length])

  // Esc closes, Delete removes the selected point / hole
  useEffect(() => {
    if (!open) return
    const k = e => {
      if (e.key === 'Escape' && !busy) onClose && onClose()
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); remove(sel) }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, busy, sel, pts, holes])

  // wheel zoom around the cursor (needs a non-passive native listener)
  useEffect(() => {
    const el = svgRef.current
    if (!open || !el) return
    const w = e => {
      e.preventDefault()
      const f = e.deltaY > 0 ? 1.12 : 1 / 1.12
      const p = toWorld(e)
      setView(v => {
        const span = Math.min(Math.max(v.span * f, 1), 5000)
        const k = span / v.span
        return { span, cx: p[0] + (v.cx - p[0]) * k, cy: p[1] + (v.cy - p[1]) * k }
      })
    }
    el.addEventListener('wheel', w, { passive: false })
    return () => el.removeEventListener('wheel', w)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const W = view.span * (4 / 3), H = view.span
  const vb = `${view.cx - W / 2} ${-(view.cy + H / 2)} ${W} ${H}`
  const hr = view.span / 70               // handle radius in world units
  const lw = view.span / 400

  function toWorld(e) {
    const svg = svgRef.current
    const pt = svg.createSVGPoint()
    pt.x = e.clientX; pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM().inverse())
    return [p.x, -p.y]
  }
  const sn = v => (snap > 0 ? r3(Math.round(v / snap) * snap) : r3(v))
  const clampX = x => (mode === 'revolve' ? Math.max(0, x) : x)

  const setPt = (i, x, y) => setPts(p => p.map((q, k) => (k === i ? [clampX(x), y] : q)))
  const setHole = (i, o) => setHoles(h => h.map((q, k) => (k === i ? { ...q, ...o } : q)))
  function remove(s) {
    if (s.k === 'pt') { if (pts.length > 3) setPts(p => p.filter((_, i) => i !== s.i)) }
    else setHoles(h => h.filter((_, i) => i !== s.i))
    setSel(null)
  }

  const nearestEdge = (x, y) => {
    let best = -1, bd = view.span * 0.06
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]
      const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy
      const t = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)) : 0
      const d = Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy))
      if (d < bd) { bd = d; best = i }
    }
    return best
  }

  const down = e => {                      // background: click = add, drag = pan
    if (e.button !== 0 && e.pointerType === 'mouse') return
    svgRef.current.setPointerCapture(e.pointerId)
    drag.current = { kind: 'bg', sx: e.clientX, sy: e.clientY, cx: view.cx, cy: view.cy, moved: false }
  }
  const downHandle = (e, k, i) => {
    e.stopPropagation()
    svgRef.current.setPointerCapture(e.pointerId)
    drag.current = { kind: k, i }
    setSel({ k, i })
  }
  const move = e => {
    const d = drag.current
    if (!d) return
    if (d.kind === 'bg') {
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy
      if (Math.hypot(dx, dy) > 4) d.moved = true
      if (d.moved) {
        const rect = svgRef.current.getBoundingClientRect()
        const k = (viewRef.current.span * (4 / 3)) / rect.width
        setView(v => ({ ...v, cx: d.cx - dx * k, cy: d.cy + dy * k }))
      }
      return
    }
    const [x, y] = toWorld(e)
    if (d.kind === 'pt') setPt(d.i, sn(x), sn(y))
    else setHole(d.i, { x: sn(x), y: sn(y) })
  }
  const up = e => {
    const d = drag.current
    drag.current = null
    if (!d || d.kind !== 'bg' || d.moved) return
    const [x0, y0] = toWorld(e)
    const x = sn(x0), y = sn(y0)
    if (tool === 'hole' && mode === 'polygon') {
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
      const dd = Math.max(1, Math.round((Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 6) * 2) / 2)
      setHoles(h => { setSel({ k: 'hole', i: h.length }); return [...h, { x, y, d: dd }] })
      return
    }
    const cx = clampX(x)
    const at = nearestEdge(x0, y0)
    setPts(p => {
      const q = p.slice()
      const i = at >= 0 && at < p.length - 1 ? at + 1 : p.length
      q.splice(i, 0, [cx, y])
      setSel({ k: 'pt', i })
      return q
    })
  }

  const loadPreset = key => {
    const f = PRESETS[mode][key]
    if (!f) return
    const p = f()
    setPts(p.pts); setHoles([]); setSel(null)
    if (mode === 'polygon') { setThick(p.t); setExtra({}) } else setExtra({ radial: p.radial || [] })
    fitTo(p.pts, [], mode)
  }
  const switchMode = m => {
    if (m === mode) return
    const p = m === 'polygon' ? PRESETS.polygon.Rectangle() : PRESETS.revolve.Cylinder()
    setMode(m); setPts(p.pts); setHoles([]); setSel(null); setExtra({})
    if (m === 'polygon') setThick(p.t)
    fitTo(p.pts, [], m)
  }

  const go = async () => {
    setBusy(true); setErr(''); setLogs([])
    try {
      const r = await buildShape({ spec, name: name.trim(), material, parentJob }, setLogs)
      onResult && onResult(r, spec, name.trim())
      onClose && onClose()
    } catch (e) {
      setErr(e.message || 'Build failed')
    } finally { setBusy(false) }
  }

  // grid
  const step = nice(view.span / 8)
  const gx0 = Math.floor((view.cx - W / 2) / step), gx1 = Math.ceil((view.cx + W / 2) / step)
  const gy0 = Math.floor((view.cy - H / 2) / step), gy1 = Math.ceil((view.cy + H / 2) / step)
  const gridX = [], gridY = []
  for (let i = gx0; i <= gx1 && gridX.length < 80; i++) gridX.push(i * step)
  for (let i = gy0; i <= gy1 && gridY.length < 80; i++) gridY.push(i * step)

  const path = (arr, mirror) => arr.map((p, i) => `${i ? 'L' : 'M'}${mirror ? -p[0] : p[0]} ${p[1]}`).join(' ') + 'Z'
  const lab = mode === 'polygon' ? ['x', 'y'] : ['r', 'z']
  const acc = 'var(--acc,#f26a1b)'
  const fs = view.span / 40
  const volTxt = stat.volume_mm3 ? ` · ${(stat.volume_mm3 / 1000).toFixed(2)} cm³` : ''
  const sizeTxt = stat.bbox ? stat.bbox.map(v => Math.round(v * 10) / 10).join(' × ') + ' mm' : ''

  return (
    <div className="se-wrap" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose && onClose() }}>
      <style>{CSS}</style>
      <div className="se" role="dialog" aria-label="Shape editor">
        <div className="se-h">
          <b>Draw your own shape</b>
          <small>{mode === 'polygon' ? 'Outline in the XY plane, extruded up' : 'Half-section (radius, height), revolved around the Z axis'}</small>
          <button className="btn se-x" onClick={() => !busy && onClose && onClose()} aria-label="Close">✕</button>
        </div>
        <div className="se-b">
          <div className="se-l">
            <div className="se-bar">
              <button className={'btn' + (mode === 'polygon' ? ' on' : '')} onClick={() => switchMode('polygon')}>Extrude outline</button>
              <button className={'btn' + (mode === 'revolve' ? ' on' : '')} onClick={() => switchMode('revolve')}>Revolve profile</button>
              <select defaultValue="" onChange={e => { loadPreset(e.target.value); e.target.value = '' }} aria-label="Start from a preset">
                <option value="" disabled>Presets…</option>
                {Object.keys(PRESETS[mode]).map(k => <option key={k}>{k}</option>)}
              </select>
              {mode === 'polygon' && (
                <>
                  <button className={'btn' + (tool === 'point' ? ' on' : '')} onClick={() => setTool('point')}>Add points</button>
                  <button className={'btn' + (tool === 'hole' ? ' on' : '')} onClick={() => setTool('hole')}>Add holes</button>
                </>
              )}
              <select value={snap} onChange={e => setSnap(Number(e.target.value))} aria-label="Snap to grid">
                <option value={0}>Snap: off</option><option value={0.5}>Snap 0.5 mm</option><option value={1}>Snap 1 mm</option>
                <option value={2}>Snap 2 mm</option><option value={5}>Snap 5 mm</option><option value={10}>Snap 10 mm</option>
              </select>
              <button className="btn" onClick={() => fitTo(pts, holes, mode)}>Fit</button>
            </div>
            <div className="se-cv">
              <svg ref={svgRef} viewBox={vb} preserveAspectRatio="xMidYMid meet"
                onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null }}>
                <g transform="scale(1,-1)">
                  {gridX.map(x => <line key={'x' + x} x1={x} x2={x} y1={view.cy - H} y2={view.cy + H} stroke="currentColor" strokeOpacity={Math.abs(x) < 1e-9 ? 0 : 0.1} strokeWidth={lw} />)}
                  {gridY.map(y => <line key={'y' + y} y1={y} y2={y} x1={view.cx - W} x2={view.cx + W} stroke="currentColor" strokeOpacity={Math.abs(y) < 1e-9 ? 0 : 0.1} strokeWidth={lw} />)}
                  <line x1={view.cx - W} x2={view.cx + W} y1={0} y2={0} stroke="currentColor" strokeOpacity={0.35} strokeWidth={lw} />
                  <line y1={view.cy - H} y2={view.cy + H} x1={0} x2={0} stroke={mode === 'revolve' ? acc : 'currentColor'} strokeOpacity={mode === 'revolve' ? 0.9 : 0.35} strokeWidth={lw * (mode === 'revolve' ? 1.6 : 1)} strokeDasharray={mode === 'revolve' ? `${step / 4} ${step / 6}` : undefined} />
                  {mode === 'revolve' && (extra.radial || []).map((f, i) => (
                    <g key={'f' + i} fill="currentColor" fillOpacity={0.08} stroke="currentColor" strokeOpacity={0.45} strokeWidth={lw * 1.5} style={{ pointerEvents: 'none' }}>
                      <path d={path(f.polygon)} /><path d={path(f.polygon, true)} />
                    </g>
                  ))}
                  {mode === 'revolve' && pts.length > 1 && <path d={path(pts, true)} fill="none" stroke="currentColor" strokeOpacity={0.3} strokeWidth={lw * 1.5} strokeDasharray={`${hr} ${hr}`} />}
                  {pts.length > 1 && <path d={path(pts)} fill={acc} fillOpacity={stat.ok || stat.offline ? 0.16 : 0.05} stroke={stat.ok || stat.offline ? acc : '#d93025'} strokeWidth={lw * 2} strokeLinejoin="round" />}
                  {mode === 'polygon' && holes.map((h, i) => (
                    <circle key={'h' + i} cx={h.x} cy={h.y} r={h.d / 2} fill="var(--bg,#faf8f5)" stroke={acc}
                      strokeWidth={lw * (sel && sel.k === 'hole' && sel.i === i ? 5 : 2)} style={{ cursor: 'move' }}
                      onPointerDown={e => downHandle(e, 'hole', i)} />
                  ))}
                  {pts.map((p, i) => (
                    <g key={i} style={{ cursor: 'move' }} onPointerDown={e => downHandle(e, 'pt', i)}
                      onDoubleClick={e => { e.stopPropagation(); remove({ k: 'pt', i }) }}>
                      <circle cx={p[0]} cy={p[1]} r={hr * 2.2} fill="transparent" />
                      <circle cx={p[0]} cy={p[1]} r={hr} fill={sel && sel.k === 'pt' && sel.i === i ? acc : 'var(--card,#fff)'} stroke={acc} strokeWidth={lw * 2} />
                      <text transform={`translate(${p[0] + hr * 1.6} ${p[1] + hr * 1.6}) scale(1 -1)`} fontSize={fs} fill="currentColor" opacity={0.6} style={{ pointerEvents: 'none' }}>{i + 1}</text>
                    </g>
                  ))}
                </g>
              </svg>
            </div>
            <div className="se-hint">Click empty space to add a point (on an edge it is inserted there) · drag a point to move it · double-click a point or press Delete to remove it · scroll to zoom · drag the background to pan.</div>
            <div className={'se-st ' + (stat.ok ? 'ok' : 'err')}>
              {stat.ok ? (stat.offline ? 'Could not reach the server to check the shape.' : `Valid shape${sizeTxt ? ' · ' + sizeTxt : ''}${volTxt}`) : stat.error}
            </div>
          </div>
          <div className="se-r">
            <label className="se-sec">Name (optional)</label>
            <input className="se-in" value={name} maxLength={80} placeholder={mode === 'polygon' ? 'e.g. mounting plate' : 'e.g. turned knob'} onChange={e => setName(e.target.value)} />
            {mode === 'polygon' && (
              <>
                <div className="se-sec">Thickness (mm)</div>
                <Num className="se-n" value={thick} onChange={v => setThick(Math.max(0.1, v))} />
              </>
            )}
            <div className="se-sec">Points ({mode === 'polygon' ? 'x, y' : 'radius, height'} in mm)</div>
            <div className="se-list">
              {pts.map((p, i) => (
                <div className="se-row" key={i} onFocus={() => setSel({ k: 'pt', i })}>
                  <span>{i + 1}</span>
                  <Num className="se-n" title={lab[0]} value={p[0]} onChange={v => setPt(i, v, p[1])} />
                  <Num className="se-n" title={lab[1]} value={p[1]} onChange={v => setPt(i, p[0], v)} />
                  <button className="btn" disabled={pts.length <= 3} onClick={() => remove({ k: 'pt', i })} aria-label={`Delete point ${i + 1}`}>×</button>
                </div>
              ))}
            </div>
            {mode === 'polygon' && (
              <>
                <div className="se-sec">Round holes (x, y, diameter)</div>
                <div className="se-list">
                  {holes.length === 0 && <div className="se-hint">None. Pick “Add holes” and click inside the outline.</div>}
                  {holes.map((h, i) => (
                    <div className="se-row h" key={i} onFocus={() => setSel({ k: 'hole', i })}>
                      <span>{i + 1}</span>
                      <Num className="se-n" title="x" value={h.x} onChange={v => setHole(i, { x: v })} />
                      <Num className="se-n" title="y" value={h.y} onChange={v => setHole(i, { y: v })} />
                      <Num className="se-n" title="diameter" value={h.d} onChange={v => setHole(i, { d: Math.max(0.1, v) })} />
                      <button className="btn" onClick={() => remove({ k: 'hole', i })} aria-label={`Delete hole ${i + 1}`}>×</button>
                    </div>
                  ))}
                </div>
                {extra.cutouts && extra.cutouts.length > 0 && <div className="se-hint">Keeps {extra.cutouts.length} polygon cut-out(s) from the original design.</div>}
              </>
            )}
            {mode === 'revolve' && extra.radial && extra.radial.length > 0 && (
              <div className="se-hint">Keeps {extra.radial.reduce((a, f) => a + f.count, 0)} fin(s) from the original design (they follow the body).</div>
            )}
          </div>
        </div>
        <div className="se-f">
          <span className="se-hint" style={{ flex: 1 }}>{busy ? (logs[logs.length - 1] || 'building…') : err ? <span style={{ color: '#d93025' }}>{err}</span> : `Material: ${material}`}</span>
          <button className="btn" onClick={() => !busy && onClose && onClose()}>Cancel</button>
          <button className="btn p" disabled={busy || !stat.ok} onClick={go}>{busy ? 'Building…' : 'Generate 3D'}</button>
        </div>
      </div>
    </div>
  )
}
