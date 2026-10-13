import { useEffect, useRef, useState } from 'react'

/* 3D viewer: software-rendered on a 2D canvas, no libraries */
const FACES = (() => {
  const F = []
  function ext(P, d, z0) {
    const k = P.length
    F.push({ v: P.map(p => [p[0], p[1], z0 + d]), n: [0, 0, 1] })
    F.push({ v: P.slice().reverse().map(p => [p[0], p[1], z0]), n: [0, 0, -1] })
    for (let i = 0; i < k; i++) {
      const a = P[i], b = P[(i + 1) % k], ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey)
      F.push({
        v: [[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z0 + d], [a[0], a[1], z0 + d]],
        n: [ey / l, -ex / l, 0]
      })
    }
  }
  ext([[0, 0], [100, 0], [100, 10], [10, 10], [10, 70], [0, 70]], 60, 0)
  ext([[10, 10], [60, 10], [10, 50]], 8, 26)
  return F
})()

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

function draw(c, S, wire) {
  if (!c) return
  const r = window.devicePixelRatio || 1
  const W = (c.width = c.clientWidth * r)
  const H = (c.height = c.clientHeight * r)
  const x = c.getContext('2d')
  const s = (Math.min(W, H) / (W < H ? 135 : 180)) * S.z
  const cy = Math.cos(S.ry), sy = Math.sin(S.ry), cx = Math.cos(S.rx), sx = Math.sin(S.rx)
  const rot = (X, Y, Z) => {
    const a = X * cy + Z * sy, d = -X * sy + Z * cy
    return [a, Y * cx - d * sx, Y * sx + d * cx]
  }
  const cs = getComputedStyle(document.documentElement)
  const acc = cs.getPropertyValue('--acc').trim()
  const dark = document.documentElement.dataset.theme === 'dark'
  const L = [0.35, 0.65, 0.7]
  const out = []
  FACES.forEach(f => {
    const n = rot(...f.n)
    if (!wire && n[2] <= 0) return
    const p = f.v.map(q => rot(q[0] - 50, q[1] - 35, q[2] - 30))
    out.push({
      p,
      z: p.reduce((a, q) => a + q[2], 0) / p.length,
      sh: Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / 1.0
    })
  })
  out.sort((a, b) => a.z - b.z)
  x.lineJoin = 'round'
  x.lineWidth = 1.5 * r
  out.forEach(o => {
    x.beginPath()
    o.p.forEach((q, i) => {
      const k = 420 / (420 - q[2]), X = W / 2 + q[0] * s * k, Y = H / 2 - q[1] * s * k
      i ? x.lineTo(X, Y) : x.moveTo(X, Y)
    })
    x.closePath()
    if (!wire) {
      const l = (dark ? 18 : 30) + o.sh * (dark ? 50 : 55)
      x.fillStyle = `hsl(215,14%,${l}%)`
      x.fill()
      x.strokeStyle = dark ? '#000' : '#0f1f3d'
      x.globalAlpha = 0.55
    } else {
      x.strokeStyle = acc
      x.globalAlpha = 0.9
    }
    x.stroke()
    x.globalAlpha = 1
  })
}

export default function Viewer3D({ open, name, fmt, onClose, onDownload }) {
  const canvasRef = useRef(null)
  const S = useRef({ rx: -0.45, ry: 0.7, z: 1, drag: false })
  const ptrs = useRef(new Map())
  const pinch = useRef(0)
  const [wire, setWire] = useState(false)
  const [auto, setAuto] = useState(true)
  const wireRef = useRef(wire)
  const autoRef = useRef(auto)
  wireRef.current = wire
  autoRef.current = auto

  const reset = () => {
    S.current.rx = -0.45
    S.current.ry = 0.7
    S.current.z = 1
  }

  /* render loop + Esc key, only while open */
  useEffect(() => {
    if (!open) return
    reset()
    let raf
    const loop = () => {
      const s = S.current
      if (autoRef.current && !s.drag) s.ry += 0.008
      draw(canvasRef.current, s, wireRef.current)
      raf = requestAnimationFrame(loop)
    }
    loop()
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  /* wheel zoom needs a non-passive native listener */
  useEffect(() => {
    const c = canvasRef.current
    const onWheel = e => {
      e.preventDefault()
      S.current.z = clamp(S.current.z * (e.deltaY < 0 ? 1.1 : 0.9), 0.4, 4)
    }
    c.addEventListener('wheel', onWheel, { passive: false })
    return () => c.removeEventListener('wheel', onWheel)
  }, [])

  const dist = () => {
    const [a, b] = [...ptrs.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  const onDown = e => {
    e.currentTarget.setPointerCapture(e.pointerId)
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (ptrs.current.size === 2) pinch.current = dist()
    S.current.drag = true
  }
  const onMove = e => {
    const p = ptrs.current.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    p.x = e.clientX
    p.y = e.clientY
    const s = S.current
    if (ptrs.current.size === 2) {
      const d = dist()
      if (pinch.current > 0) s.z = clamp(s.z * (d / pinch.current), 0.4, 4)
      pinch.current = d
      return
    }
    // single pointer: rotate
    s.ry += dx * 0.01
    s.rx = clamp(s.rx + dy * 0.01, -1.5, 1.5)
  }
  const onUp = e => {
    ptrs.current.delete(e.pointerId)
    if (ptrs.current.size < 2) pinch.current = 0
    if (ptrs.current.size === 0) S.current.drag = false
  }

  return (
    <div className={'modal' + (open ? ' on' : '')} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mbox">
        <div className="mh">
          <b>{name}.{fmt.toLowerCase()}</b>
          <button className="btn mclose" onClick={onClose}>Close</button>
          <div className="g">
            <button className={'btn' + (wire ? ' on' : '')} onClick={() => setWire(w => !w)}>
              {wire ? 'Wireframe' : 'Shaded'}
            </button>
            <button className={'btn' + (auto ? ' on' : '')} onClick={() => setAuto(a => !a)}>Auto-rotate</button>
            <button className="btn" onClick={reset}>Reset view</button>
            <button className="btn p gdl" onClick={() => onDownload(name, fmt)}>
              <svg className="i"><use href="#dl" /></svg>Download
            </button>
            <button className="btn gclose" onClick={onClose}>Close</button>
          </div>
        </div>
        <canvas
          id="c3"
          ref={canvasRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        <div className="mf">
          <span>Drag to rotate · Scroll or pinch to zoom · Esc to close</span>
          <span>100 × 70 × 60 mm</span>
        </div>
      </div>
    </div>
  )
}
