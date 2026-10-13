// src/MeshViewer.jsx
// Dependency-free software renderer + CAD overlays for the real mesh.
//   <MeshViewer mesh wire auto resetKey grid axes dims measure clearKey onMeasure />   interactive viewer
//   <Thumb mesh />                                                                      static preview image
// CAD coordinates are Z-up, millimetres. mesh = { verts:[x,y,z,...], tris:[i,j,k,...] }.
import { useEffect, useRef, useState } from 'react'

const FIT = 0.92

/* ---------- geometry cache ---------- */
const prepCache = new WeakMap()

function prep(mesh) {
  let p = prepCache.get(mesh)
  if (p) return p
  const V = mesh.verts
  const T = mesh.tris
  const n = V.length / 3
  const m = T.length / 3
  const mn = [1e9, 1e9, 1e9]
  const mx = [-1e9, -1e9, -1e9]
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = V[i * 3 + k]
      if (v < mn[k]) mn[k] = v
      if (v > mx[k]) mx[k] = v
    }
  }
  const c = mn.map((a, k) => (a + mx[k]) / 2)
  const diag = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1
  const N = new Float32Array(m * 3)
  let area = 0
  for (let t = 0; t < m; t++) {
    const a = T[t * 3] * 3
    const b = T[t * 3 + 1] * 3
    const d = T[t * 3 + 2] * 3
    const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2]
    const vx = V[d] - V[a], vy = V[d + 1] - V[a + 1], vz = V[d + 2] - V[a + 2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz) || 1
    N[t * 3] = nx / l
    N[t * 3 + 1] = ny / l
    N[t * 3 + 2] = nz / l
    area += l / 2
  }
  p = {
    V, T, n, m, c, diag, N, mn, mx, area,
    zb: mn[2] - c[2],
    P: new Float32Array(n * 3),
    D: new Float32Array(m),
    S: new Uint8Array(m),
    order: Array.from({ length: m }, (_, i) => i)
  }
  prepCache.set(mesh, p)
  return p
}

// numbers the info panel can use even for jobs made before the backend sent extras
export function meshStats(mesh) {
  const p = prep(mesh)
  return { tris: p.m, verts: p.n, area: p.area, min: p.mn, max: p.mx }
}

/* ---------- number helpers ---------- */
export const fm = v => {
  const a = Math.abs(v)
  return String(parseFloat(v.toFixed(a >= 100 ? 1 : 2)))
}
function niceStep(target) {
  const e = Math.pow(10, Math.floor(Math.log10(target)))
  const f = target / e
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e
}

/* ---------- shading ---------- */
const SHADES = {}
function shades(dark) {
  const k = dark ? 'd' : 'l'
  if (!SHADES[k]) {
    SHADES[k] = Array.from({ length: 64 }, (_, i) => {
      const f = i / 63
      return dark ? `hsl(214,20%,${(20 + f * 52).toFixed(1)}%)` : `hsl(214,17%,${(30 + f * 52).toFixed(1)}%)`
    })
  }
  return SHADES[k]
}

const LIGHT = (() => {
  const l = [-0.42, -0.5, 0.76] // (right, depth, up): upper-left, towards the viewer
  const s = Math.hypot(...l)
  return l.map(x => x / s)
})()

/* ---------- projection (orthographic, same maths as drawMesh) ---------- */
function makeProj(p, w, h, view) {
  const { yaw = -0.75, pitch = 0.5, zoom = 1 } = view
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch)
  const s = ((FIT * Math.min(w, h)) / p.diag) * zoom
  const f = (x, y, z) => {
    const X = x - p.c[0], Y = y - p.c[1], Z = z - p.c[2]
    const x1 = X * cy - Y * sy
    const y1 = X * sy + Y * cy
    return [w / 2 + x1 * s, h / 2 - (y1 * sp + Z * cp) * s, y1 * cp - Z * sp]
  }
  f.s = s
  f.dir = (vx, vy, vz) => [vx * cy - vy * sy, -((vx * sy + vy * cy) * sp + vz * cp)] // screen vector of a world vector
  return f
}

/* ---------- model ---------- */
export function drawMesh(ctx, w, h, mesh, o = {}) {
  const { yaw = -0.7, pitch = 0.5, zoom = 1, wire = false, dark = false, acc = '#f26a1b' } = o
  const p = prep(mesh)
  const { V, T, n, m, c, diag, N, P, D, S, order } = p
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch)
  const s = ((FIT * Math.min(w, h)) / diag) * zoom
  const ox = w / 2
  const oy = h / 2

  for (let i = 0; i < n; i++) {
    const x = V[i * 3] - c[0], y = V[i * 3 + 1] - c[1], z = V[i * 3 + 2] - c[2]
    const x1 = x * cy - y * sy
    const y1 = x * sy + y * cy
    P[i * 3] = ox + x1 * s
    P[i * 3 + 1] = oy - (y1 * sp + z * cp) * s
    P[i * 3 + 2] = y1 * cp - z * sp
  }

  // soft contact shadow
  const gy = oy - p.zb * cp * s
  const rx = diag * 0.4 * s
  const ry = Math.max(rx * Math.abs(sp) * 0.75, 3)
  const g = ctx.createRadialGradient(ox, gy, 0, ox, gy, rx)
  g.addColorStop(0, dark ? 'rgba(0,0,0,.55)' : 'rgba(15,31,61,.22)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.save()
  ctx.translate(0, gy)
  ctx.scale(1, ry / rx)
  ctx.translate(0, -gy)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(ox, gy, rx, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  const pal = shades(dark)
  for (let t = 0; t < m; t++) {
    const a = T[t * 3], b = T[t * 3 + 1], d = T[t * 3 + 2]
    D[t] = (P[a * 3 + 2] + P[b * 3 + 2] + P[d * 3 + 2]) / 3
    const nx = N[t * 3], ny = N[t * 3 + 1], nz = N[t * 3 + 2]
    const r = nx * cy - ny * sy
    const q = nx * sy + ny * cy
    let nr = r, nd = q * cp - nz * sp, nu = q * sp + nz * cp
    if (nd > 0) { nr = -nr; nd = -nd; nu = -nu }
    const diff = Math.max(0, nr * LIGHT[0] + nd * LIGHT[1] + nu * LIGHT[2])
    S[t] = Math.min(63, Math.round((0.18 + 0.82 * diff) * 63))
  }
  order.sort((i, j) => D[j] - D[i])

  ctx.lineJoin = 'round'
  if (wire) {
    ctx.strokeStyle = acc
    ctx.globalAlpha = m > 20000 ? 0.35 : 0.8
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let k = 0; k < m; k++) {
      const t = order[k]
      const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, d = T[t * 3 + 2] * 3
      ctx.moveTo(P[a], P[a + 1]); ctx.lineTo(P[b], P[b + 1]); ctx.lineTo(P[d], P[d + 1]); ctx.closePath()
    }
    ctx.stroke()
    ctx.globalAlpha = 1
    return
  }
  const seam = m < 60000
  ctx.lineWidth = 0.7
  let last = -1
  for (let k = 0; k < m; k++) {
    const t = order[k]
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, d = T[t * 3 + 2] * 3
    if (S[t] !== last) { last = S[t]; ctx.fillStyle = pal[last]; ctx.strokeStyle = pal[last] }
    ctx.beginPath()
    ctx.moveTo(P[a], P[a + 1]); ctx.lineTo(P[b], P[b + 1]); ctx.lineTo(P[d], P[d + 1])
    ctx.closePath()
    ctx.fill()
    if (seam) ctx.stroke()
  }
}

/* ---------- CAD overlays ---------- */
const AX = { x: '#e5484d', y: '#30a46c', z: '#3e63dd' }
const BND = { w: 0, h: 0 }

function theme(dark) {
  return dark
    ? { ink: '#ececec', mute: '#8a8a8a', pill: 'rgba(17,17,17,.94)', edge: '#3a3a3a', grid: 'rgba(255,255,255,.09)', gridO: 'rgba(255,255,255,.24)' }
    : { ink: '#0f1f3d', mute: '#6b7488', pill: 'rgba(255,255,255,.96)', edge: '#cfc9bc', grid: 'rgba(15,31,61,.10)', gridO: 'rgba(15,31,61,.30)' }
}

const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'

function pill(ctx, text, x, y, T, color) {
  ctx.font = `600 11px ${MONO}`
  const w = ctx.measureText(text).width + 12
  const h = 18
  x = Math.max(w / 2 + 3, Math.min(BND.w - w / 2 - 3, x))
  y = Math.max(h / 2 + 3, Math.min(BND.h - h / 2 - 3, y))
  ctx.fillStyle = T.pill
  ctx.strokeStyle = color || T.edge
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.rect(Math.round(x - w / 2) + 0.5, Math.round(y - h / 2) + 0.5, w, h)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = T.ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y + 0.5)
}

function head(ctx, P, Q) {
  const a = Math.atan2(Q[1] - P[1], Q[0] - P[0])
  const ca = Math.cos(a), sa = Math.sin(a)
  ctx.beginPath()
  ctx.moveTo(P[0], P[1])
  ctx.lineTo(P[0] + ca * 9 - sa * 3.5, P[1] + sa * 9 + ca * 3.5)
  ctx.lineTo(P[0] + ca * 9 + sa * 3.5, P[1] + sa * 9 - ca * 3.5)
  ctx.closePath()
  ctx.fill()
}

function dimLine(ctx, A, B, color) {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1.3
  ctx.beginPath()
  ctx.moveTo(A[0], A[1])
  ctx.lineTo(B[0], B[1])
  ctx.stroke()
  if (Math.hypot(B[0] - A[0], B[1] - A[1]) > 22) { head(ctx, A, B); head(ctx, B, A) }
}

export function drawGrid(ctx, w, h, mesh, view, o = {}) {
  const p = prep(mesh)
  const pr = makeProj(p, w, h, view)
  const T = theme(o.dark)
  const [mn0, mn1, mn2] = p.mn
  const [mx0, mx1] = p.mx
  const step = niceStep(p.diag / 8)
  const x0 = Math.floor(mn0 / step) * step - step
  const y0 = Math.floor(mn1 / step) * step - step
  const nx = Math.min(60, Math.round((Math.ceil(mx0 / step) * step + step - x0) / step))
  const ny = Math.min(60, Math.round((Math.ceil(mx1 / step) * step + step - y0) / step))
  const x1 = x0 + nx * step
  const y1 = y0 + ny * step
  BND.w = w; BND.h = h
  ctx.save()
  ctx.lineWidth = 1
  for (let i = 0; i <= nx; i++) {
    const x = x0 + i * step
    ctx.strokeStyle = Math.abs(x) < step * 1e-3 ? T.gridO : T.grid
    const a = pr(x, y0, mn2), b = pr(x, y1, mn2)
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke()
  }
  for (let j = 0; j <= ny; j++) {
    const y = y0 + j * step
    ctx.strokeStyle = Math.abs(y) < step * 1e-3 ? T.gridO : T.grid
    const a = pr(x0, y, mn2), b = pr(x1, y, mn2)
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke()
  }
  // coordinate labels on the two nearest grid edges
  const gc = pr((x0 + x1) / 2, (y0 + y1) / 2, mn2)
  const yEdge = pr(x0, y0, mn2)[2] < pr(x0, y1, mn2)[2] ? y0 : y1
  const xEdge = pr(x0, y0, mn2)[2] < pr(x1, y0, mn2)[2] ? x0 : x1
  ctx.font = `10px ${MONO}`
  ctx.fillStyle = T.mute
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const put = (pt, txt) => {
    const dx = pt[0] - gc[0], dy = pt[1] - gc[1]
    const l = Math.hypot(dx, dy) || 1
    ctx.fillText(txt, pt[0] + (dx / l) * 14, pt[1] + (dy / l) * 14)
  }
  const skipX = nx > 16 ? 2 : 1
  const skipY = ny > 16 ? 2 : 1
  for (let i = 0; i <= nx; i += skipX) put(pr(x0 + i * step, yEdge, mn2), fm(x0 + i * step))
  for (let j = 0; j <= ny; j += skipY) put(pr(xEdge, y0 + j * step, mn2), fm(y0 + j * step))
  ctx.restore()
}

export function drawOverlay(ctx, w, h, mesh, view, o = {}) {
  const p = prep(mesh)
  const pr = makeProj(p, w, h, view)
  const T = theme(o.dark)
  const acc = o.acc || '#f26a1b'
  const [mn0, mn1, mn2] = p.mn
  const [mx0, mx1, mx2] = p.mx
  BND.w = w; BND.h = h
  ctx.save()
  ctx.lineJoin = 'round'

  /* bounding box + dimension lines */
  if (o.dims) {
    const C = []
    for (const x of [mn0, mx0]) for (const y of [mn1, mx1]) for (const z of [mn2, mx2]) C.push(pr(x, y, z))
    const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]
    ctx.save()
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = T.mute
    ctx.globalAlpha = 0.6
    ctx.lineWidth = 1
    ctx.beginPath()
    E.forEach(([a, b]) => { ctx.moveTo(C[a][0], C[a][1]); ctx.lineTo(C[b][0], C[b][1]) })
    ctx.stroke()
    ctx.restore()

    const cx = (mn0 + mx0) / 2, cyy = (mn1 + mx1) / 2
    const yf = pr(cx, mn1, mn2)[2] < pr(cx, mx1, mn2)[2] ? mn1 : mx1
    const yo = yf === mn1 ? -1 : 1
    const xf = pr(mn0, cyy, mn2)[2] < pr(mx0, cyy, mn2)[2] ? mn0 : mx0
    const xo = xf === mn0 ? -1 : 1
    const off = p.diag * 0.08
    const ext = (a3, b3) => {
      const a = pr(...a3), b = pr(...b3)
      ctx.save()
      ctx.setLineDash([2, 3])
      ctx.strokeStyle = acc
      ctx.globalAlpha = 0.7
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke()
      ctx.restore()
    }
    const dim = (A, B, E1, E2, label) => {
      ext(E1, A); ext(E2, B)
      const a = pr(...A), b = pr(...B)
      dimLine(ctx, a, b, acc)
      pill(ctx, label, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, T, acc)
    }
    dim([mn0, yf + yo * off, mn2], [mx0, yf + yo * off, mn2], [mn0, yf, mn2], [mx0, yf, mn2], `X ${fm(mx0 - mn0)} mm`)
    dim([xf + xo * off, mn1, mn2], [xf + xo * off, mx1, mn2], [xf, mn1, mn2], [xf, mx1, mn2], `Y ${fm(mx1 - mn1)} mm`)
    let best = null
    for (const x of [mn0, mx0]) for (const y of [mn1, mx1]) {
      const sx = pr(x, y, mn2)[0]
      if (!best || sx < best.sx) best = { x, y, sx }
    }
    const ox = best.x === mn0 ? -1 : 1, oy = best.y === mn1 ? -1 : 1
    dim([best.x + ox * off, best.y + oy * off, mn2], [best.x + ox * off, best.y + oy * off, mx2],
      [best.x, best.y, mn2], [best.x, best.y, mx2], `Z ${fm(mx2 - mn2)} mm`)
  }

  /* axes: world origin + corner triad */
  if (o.axes) {
    const L = niceStep(p.diag * 0.25)
    const O = pr(0, 0, 0)
    const ax = [['X', [L, 0, 0], AX.x], ['Y', [0, L, 0], AX.y], ['Z', [0, 0, L], AX.z]]
    ctx.lineWidth = 2
    ctx.font = `700 11px ${MONO}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ax.forEach(([nm, v, col]) => {
      const e = pr(...v)
      ctx.strokeStyle = col; ctx.fillStyle = col
      ctx.beginPath(); ctx.moveTo(O[0], O[1]); ctx.lineTo(e[0], e[1]); ctx.stroke()
      head(ctx, e, O)
      const dx = e[0] - O[0], dy = e[1] - O[1], l = Math.hypot(dx, dy) || 1
      ctx.fillText(nm, e[0] + (dx / l) * 10, e[1] + (dy / l) * 10)
    })
    ctx.fillStyle = T.ink
    ctx.beginPath(); ctx.arc(O[0], O[1], 3.2, 0, Math.PI * 2); ctx.fill()
    ctx.font = `10px ${MONO}`
    ctx.fillStyle = T.mute
    ctx.textAlign = 'left'
    ctx.fillText('O (0, 0, 0)', O[0] + 7, O[1] + 12)

    const bx = 44, by = h - 46
    ctx.lineWidth = 1.8
    ax.forEach(([nm, v, col]) => {
      const d = pr.dir(v[0] ? 1 : 0, v[1] ? 1 : 0, v[2] ? 1 : 0)
      const e = [bx + d[0] * 30, by + d[1] * 30]
      ctx.strokeStyle = col; ctx.fillStyle = col
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(e[0], e[1]); ctx.stroke()
      ctx.font = `700 11px ${MONO}`
      ctx.textAlign = 'center'
      ctx.fillText(nm, e[0] + d[0] * 9, e[1] + d[1] * 9)
    })
  }

  /* scale bar */
  if (o.axes || o.dims || o.grid) {
    const mm = niceStep(110 / pr.s)
    const px = mm * pr.s
    const x0 = w / 2 - px / 2
    const y = h - 22
    ctx.strokeStyle = T.ink
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x0, y - 5); ctx.lineTo(x0, y); ctx.lineTo(x0 + px, y); ctx.lineTo(x0 + px, y - 5)
    ctx.stroke()
    ctx.font = `600 11px ${MONO}`
    ctx.fillStyle = T.ink
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(`${fm(mm)} mm`, w / 2, y - 9)
    ctx.font = `10px ${MONO}`
    ctx.fillStyle = T.mute
    ctx.fillText(`1 px = ${fm(1 / pr.s)} mm`, w / 2, y + 12)
    ctx.textBaseline = 'middle'
  }

  /* measure: hover snap + picked points */
  if (o.measure) {
    const pts = o.pts || []
    const sp = pts.map(q => pr(q[0], q[1], q[2]))
    if (sp.length === 2) {
      ctx.save()
      ctx.setLineDash([6, 4])
      ctx.strokeStyle = acc
      ctx.lineWidth = 1.6
      ctx.beginPath(); ctx.moveTo(sp[0][0], sp[0][1]); ctx.lineTo(sp[1][0], sp[1][1]); ctx.stroke()
      ctx.restore()
      const dx = pts[1][0] - pts[0][0], dy = pts[1][1] - pts[0][1], dz = pts[1][2] - pts[0][2]
      const d = Math.hypot(dx, dy, dz)
      const mx = (sp[0][0] + sp[1][0]) / 2, my = (sp[0][1] + sp[1][1]) / 2
      pill(ctx, `d = ${fm(d)} mm`, mx, my - 12, T, acc)
      pill(ctx, `dx ${fm(dx)}  dy ${fm(dy)}  dz ${fm(dz)}`, mx, my + 10, T)
    }
    sp.forEach((s, i) => {
      ctx.fillStyle = acc
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(s[0], s[1], 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.font = `700 11px ${MONO}`
      ctx.fillStyle = T.ink
      ctx.textAlign = 'center'
      ctx.fillText(i ? 'B' : 'A', s[0] + 11, s[1] - 11)
    })
    if (o.hover) {
      const hp = pr(o.hover[0], o.hover[1], o.hover[2])
      ctx.strokeStyle = acc
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.arc(hp[0], hp[1], 8, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(hp[0] - 13, hp[1]); ctx.lineTo(hp[0] - 4, hp[1])
      ctx.moveTo(hp[0] + 4, hp[1]); ctx.lineTo(hp[0] + 13, hp[1])
      ctx.moveTo(hp[0], hp[1] - 13); ctx.lineTo(hp[0], hp[1] - 4)
      ctx.moveTo(hp[0], hp[1] + 4); ctx.lineTo(hp[0], hp[1] + 13)
      ctx.stroke()
      pill(ctx, `x ${fm(o.hover[0])}  y ${fm(o.hover[1])}  z ${fm(o.hover[2])}`, hp[0], hp[1] - 24, T, acc)
    }
  }
  ctx.restore()
}

// nearest visible vertex to a screen point (uses the projection of the last drawMesh)
export function snap(mesh, px, py, R = 14) {
  const p = prep(mesh)
  const { P, n } = p
  let best = -1
  let bd = 1e18
  const R2 = R * R
  for (let i = 0; i < n; i++) {
    const dx = P[i * 3] - px, dy = P[i * 3 + 1] - py
    if (dx * dx + dy * dy <= R2 && P[i * 3 + 2] < bd) { bd = P[i * 3 + 2]; best = i }
  }
  return best
}

/* ---------- theme helper ---------- */
export function useDark() {
  const get = () => document.documentElement.dataset.theme === 'dark'
  const [d, setD] = useState(get)
  useEffect(() => {
    const mo = new MutationObserver(() => setD(get()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])
  return d
}

/* ---------- static thumbnail ---------- */
const thumbCache = new WeakMap()

export function thumbnail(mesh, w = 720, h = 440, o = {}) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  drawMesh(c.getContext('2d'), w, h, mesh, { yaw: -0.75, pitch: 0.5, ...o })
  return c.toDataURL('image/png')
}

export function Thumb({ mesh, alt = '3D preview' }) {
  const dark = useDark()
  const [src, setSrc] = useState(null)
  useEffect(() => {
    if (!mesh || !mesh.verts || !mesh.verts.length) { setSrc(null); return }
    const key = dark ? 'd' : 'l'
    let tc = thumbCache.get(mesh)
    if (!tc) { tc = {}; thumbCache.set(mesh, tc) }
    if (tc[key]) { setSrc(tc[key]); return }
    const id = setTimeout(() => {
      try {
        const u = thumbnail(mesh, 720, 440, { dark })
        tc[key] = u
        setSrc(u)
      } catch { setSrc(null) }
    }, 0)
    return () => clearTimeout(id)
  }, [mesh, dark])
  return src ? <img src={src} alt={alt} draggable={false} /> : null
}

/* ---------- interactive viewer ---------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

export default function MeshViewer({
  mesh, wire = false, auto = true, resetKey = 0,
  grid = false, axes = false, dims = false, measure = false, clearKey = 0, onMeasure
}) {
  const cv = useRef(null)
  const S = useRef({ yaw: -0.75, pitch: 0.5, zoom: 1, drag: false, dirty: true, hover: -1, pts: [] })
  const opt = useRef({})
  opt.current = { wire, auto, grid, axes, dims, measure }
  const cb = useRef(onMeasure)
  cb.current = onMeasure
  const dark = useDark()
  const darkRef = useRef(dark)
  darkRef.current = dark
  const ptrs = useRef(new Map())
  const pinch = useRef(0)
  const down = useRef(null)

  useEffect(() => { Object.assign(S.current, { yaw: -0.75, pitch: 0.5, zoom: 1, dirty: true }) }, [resetKey])
  useEffect(() => { S.current.dirty = true }, [wire, grid, axes, dims, measure, dark])
  useEffect(() => {
    S.current.pts = []
    S.current.hover = -1
    S.current.dirty = true
    cb.current && cb.current([])
  }, [clearKey, mesh])

  useEffect(() => {
    const c = cv.current
    if (!c || !mesh || !mesh.verts || !mesh.verts.length) return
    const ctx = c.getContext('2d')
    let raf = 0
    let alive = true
    const loop = () => {
      if (!alive) return
      const s = S.current
      if (opt.current.auto && !s.drag) { s.yaw += 0.006; s.dirty = true }
      if (s.dirty) {
        s.dirty = false
        const r = window.devicePixelRatio || 1
        const w = c.clientWidth
        const h = c.clientHeight
        if (c.width !== Math.round(w * r) || c.height !== Math.round(h * r)) {
          c.width = Math.round(w * r)
          c.height = Math.round(h * r)
        }
        ctx.setTransform(r, 0, 0, r, 0, 0)
        ctx.clearRect(0, 0, w, h)
        const o = opt.current
        const acc = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '#f26a1b'
        const view = { yaw: s.yaw, pitch: s.pitch, zoom: s.zoom }
        const dk = darkRef.current
        if (o.grid) drawGrid(ctx, w, h, mesh, view, { dark: dk })
        drawMesh(ctx, w, h, mesh, { ...view, wire: o.wire, dark: dk, acc })
        const V = mesh.verts
        const hv = s.hover >= 0 ? [V[s.hover * 3], V[s.hover * 3 + 1], V[s.hover * 3 + 2]] : null
        drawOverlay(ctx, w, h, mesh, view, { dark: dk, acc, grid: o.grid, axes: o.axes, dims: o.dims, measure: o.measure, hover: hv, pts: s.pts })
      }
      raf = requestAnimationFrame(loop)
    }
    loop()
    const ro = new ResizeObserver(() => { S.current.dirty = true })
    ro.observe(c)
    const onWheel = e => {
      e.preventDefault()
      S.current.zoom = clamp(S.current.zoom * (e.deltaY < 0 ? 1.1 : 0.9), 0.3, 6)
      S.current.dirty = true
    }
    c.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      ro.disconnect()
      c.removeEventListener('wheel', onWheel)
    }
  }, [mesh])

  const pos = e => {
    const r = cv.current.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const dist = () => {
    const [a, b] = [...ptrs.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  const onDown = e => {
    e.currentTarget.setPointerCapture(e.pointerId)
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (ptrs.current.size === 2) pinch.current = dist()
    S.current.drag = true
    down.current = { x: e.clientX, y: e.clientY, moved: false }
  }
  const onMove = e => {
    const p = ptrs.current.get(e.pointerId)
    const s = S.current
    if (!p) { // plain hover: snap to the nearest vertex while measuring
      if (opt.current.measure && mesh) {
        const [x, y] = pos(e)
        const i = snap(mesh, x, y)
        if (i !== s.hover) { s.hover = i; s.dirty = true }
      }
      return
    }
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    p.x = e.clientX
    p.y = e.clientY
    if (down.current && Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) > 5) down.current.moved = true
    if (ptrs.current.size === 2) {
      const d = dist()
      if (pinch.current > 0) s.zoom = clamp(s.zoom * (d / pinch.current), 0.3, 6)
      pinch.current = d
    } else {
      s.yaw += dx * 0.01
      s.pitch = clamp(s.pitch + dy * 0.01, -1.4, 1.4)
    }
    s.dirty = true
  }
  const onUp = e => {
    const wasClick = down.current && !down.current.moved && ptrs.current.size === 1
    ptrs.current.delete(e.pointerId)
    if (ptrs.current.size < 2) pinch.current = 0
    if (ptrs.current.size === 0) S.current.drag = false
    if (wasClick && opt.current.measure && mesh) {
      const [x, y] = pos(e)
      const i = snap(mesh, x, y, 18)
      if (i >= 0) {
        const V = mesh.verts
        const q = [V[i * 3], V[i * 3 + 1], V[i * 3 + 2]]
        const s = S.current
        s.pts = s.pts.length >= 2 ? [q] : [...s.pts, q]
        s.dirty = true
        cb.current && cb.current(s.pts)
      }
    }
    down.current = null
  }

  return (
    <div className="mv" style={measure ? { cursor: 'crosshair' } : undefined}>
      <canvas
        ref={cv}
        style={measure ? { cursor: 'crosshair' } : undefined}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => { if (S.current.hover !== -1) { S.current.hover = -1; S.current.dirty = true } }}
        onDoubleClick={() => { Object.assign(S.current, { yaw: -0.75, pitch: 0.5, zoom: 1, dirty: true }) }}
      />
    </div>
  )
}
