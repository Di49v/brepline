// src/MeshViewer.jsx
// Dependency-free software renderer + Multi-Color Sub-Parts + Real-Time 60 FPS Crash/Stress Lab + CAD overlays for the real mesh.
//   <MeshViewer mesh wire auto resetKey grid axes dims measure clearKey onMeasure />   interactive viewer
//   <Thumb mesh />                                                                      static preview image
// CAD coordinates are Z-up, millimetres. mesh = { verts:[x,y,z,...], tris:[i,j,k,...] }.
import { useEffect, useRef, useState } from 'react'

const FIT = 0.68

// Default engineering palette when a multi-part assembly has multiple named parts
const DEFAULT_PART_HEX = [
  '#94a3b8', // Metallic Silver (Fuselage / Chassis)
  '#ef4444', // Racing Crimson (Bodywork / Nose Cone)
  '#38bdf8', // Sky-Blue Glass (Windshield / Canopy)
  '#1e293b', // Vulcanized Charcoal (Tires / Wheels / Fins)
  '#eab308', // Machined Brass / Gold
  '#2fb67c', // Emerald Polymer
]

/* ---------- hex to HSL conversion for 64-step Lambertian shading per part ---------- */
function hexToHsl(hex) {
  let c = String(hex || '#94a3b8').replace('#', '').trim()
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2]
  const num = parseInt(c, 16)
  if (Number.isNaN(num)) return [214, 18, 55]
  const r = ((num >> 16) & 255) / 255
  const g = ((num >> 8) & 255) / 255
  const b = (num & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0, l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      case b: h = (r - g) / d + 4; break
    }
    h /= 6
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]
}

const PALETTE_CACHE = {}
function shadePaletteForHex(hex, dark) {
  const key = `${hex}_${dark ? 'd' : 'l'}`
  if (!PALETTE_CACHE[key]) {
    const [h, s, baseL] = hexToHsl(hex)
    const minL = Math.max(8, Math.min(35, baseL * (dark ? 0.38 : 0.48)))
    const spanL = Math.max(28, Math.min(62, baseL * 0.85))
    PALETTE_CACHE[key] = Array.from({ length: 64 }, (_, i) => {
      const f = i / 63
      return `hsl(${h},${s}%,${(minL + f * spanL).toFixed(1)}%)`
    })
  }
  return PALETTE_CACHE[key]
}

// FEA Stress Heatmap Palette (0 = Cool Blue/Green Safe -> 63 = Glowing Red Yield/Fracture)
const HEATMAP_PALETTE = Array.from({ length: 64 }, (_, i) => {
  const f = i / 63
  const hue = Math.round((1 - f) * 145) // 145 (Green) -> 60 (Yellow) -> 0 (Red)
  return `hsl(${hue}, 88%, ${(42 + f * 14).toFixed(1)}%)`
})

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
    Stress: new Uint8Array(m),
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
  f.dir = (vx, vy, vz) => [vx * cy - vy * sy, -((vx * sy + vy * cy) * sp + vz * cp)]
  return f
}

/* ---------- model + multi-part coloring + real-time crash/stress deformation ---------- */
export function drawMesh(ctx, w, h, mesh, o = {}) {
  const {
    yaw = -0.7, pitch = 0.5, zoom = 1, wire = false, dark = false, acc = '#f26a1b',
    partColors = null, sim = null
  } = o
  const p = prep(mesh)
  const { V, T, n, m, c, diag, N, P, D, S, Stress, order } = p
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch)
  const s = ((FIT * Math.min(w, h)) / diag) * zoom
  const ox = w / 2
  const oy = h / 2

  // Determine primary longest horizontal axis (0 = X, 1 = Y) for crash motion & crumple
  const spanX = p.mx[0] - p.mn[0]
  const spanY = p.mx[1] - p.mn[1]
  const spanZ = p.mx[2] - p.mn[2]

  // Axis detection: Vertical rockets/towers crash nose-first along +Z (axis 2); Cars/vehicles crash along +X (axis 0)
  const crashAxis = (sim && sim.impactAxis === 'Z') || (spanZ > spanX * 1.35 && spanZ > spanY * 1.35)
    ? 2
    : (spanX >= spanY ? 0 : 1)
  const frontMax = p.mx[crashAxis]
  const frontSpan = Math.max(p.mx[crashAxis] - p.mn[crashAxis], 1)

  // Real-time simulation parameters (progress 0.0 -> 1.0)
  const simActive = sim && sim.active
  // Smooth cubic ease-out after impact so motion feels physically damped
  const rawProg = simActive ? Math.min(1, Math.max(0, sim.progress || 0)) : 0
  const prog = rawProg
  const crumpleRatio = simActive ? Math.min(0.68, Math.max(0.03, sim.crumpleRatio || 0.18)) : 0
  const obstacle = simActive ? (sim.obstacle || 'concrete_wall') : null
  const failureMode = simActive ? (sim.failureMode || 'ductile_crumple') : 'ductile_crumple'
  const showHeatmap = simActive ? Boolean(sim.showHeatmap) : false

  // Classify each vertex by its sub-part role using mesh.parts & mesh.tri_part
  const partNames = mesh.parts || []
  const triPart = mesh.tri_part || null
  const vRole = simActive && partNames.length && triPart ? new Uint8Array(n) : null // 0=body, 1=wheel, 2=glass, 3=aero
  if (vRole) {
    const pRoles = partNames.map(nm => {
      const s = String(nm || '').toLowerCase()
      if (s.includes('wheel') || s.includes('tire') || s.includes('tyre')) return 1
      if (s.includes('glass') || s.includes('window') || s.includes('windshield') || s.includes('canopy')) return 2
      if (s.includes('fin') || s.includes('wing') || s.includes('spoiler')) return 3
      return 0
    })
    for (let t = 0; t < m; t++) {
      const rCode = pRoles[triPart[t] % pRoles.length] || 0
      if (rCode > 0) {
        vRole[T[t * 3]] = rCode
        vRole[T[t * 3 + 1]] = rCode
        vRole[T[t * 3 + 2]] = rCode
      }
    }
  }

  // Stationary Obstacle Plane in World Coordinates (`fixedWallCoord` NEVER moves!)
  // During approach (0 -> 0.40): vehicle moves from -0.28*L up to touching the stationary wall.
  // During impact (0.40 -> 1.0): vehicle continues advancing by +crumpleRatio*L into the stationary wall!
  const fixedWallCoord = frontMax - frontSpan * 0.04
  const impactPhase = prog <= 0.40 ? 0 : 1 - Math.pow(1 - (prog - 0.40) / 0.60, 2.2)
  const crushAdvance = impactPhase * crumpleRatio * frontSpan
  const approachShift = prog <= 0.40
    ? -(1 - prog / 0.40) * (frontSpan * 0.28)
    : crushAdvance

  const vStress = simActive ? new Float32Array(n) : null

  for (let i = 0; i < n; i++) {
    let vx = V[i * 3]
    let vy = V[i * 3 + 1]
    let vz = V[i * 3 + 2]
    let localStress = 0
    const role = vRole ? vRole[i] : 0

    if (simActive) {
      if (obstacle === 'wind_and_thrust') {
        // High-altitude diagonal crosswind shear + cantilever deflection along top (+Z)
        const zNorm = Math.max(0, (vz - p.mn[2]) / Math.max(spanZ, 1))
        const flutter = Math.sin(prog * Math.PI * 6) * 0.30 + 0.70
        const aeroMult = role === 3 ? 2.2 : 1.0
        const bendDeflect = (zNorm * zNorm) * (Math.max(spanX, spanY) * 0.09) * Math.max(crumpleRatio, 0.14) * 2.5 * flutter * aeroMult
        vy += bendDeflect
        localStress = Math.min(1, zNorm * 1.15 * flutter * (role === 3 ? 1.4 : 0.9))
      } else if (obstacle === 'spike_strip') {
        // Vehicle drives forward along X across the stationary spike strip at X = c[0]
        const travel = (prog - 0.35) * (spanX * 0.45)
        vx += travel
        const zFromGround = vz - p.mn[2]
        const tireRadiusEst = spanZ * 0.28
        const isWheel = vRole ? role === 1 : (zFromGround < tireRadiusEst)

        if (prog > 0.30) {
          const deflateProg = Math.min(1, (prog - 0.30) / 0.70)
          if (isWheel) {
            // ONLY wheel/tire vertices flatten at the bottom & shred laterally!
            if (zFromGround < tireRadiusEst * 0.75) {
              const crushUp = (tireRadiusEst * 0.75 - zFromGround) * 0.72 * deflateProg
              vz += crushUp
              vy += (vy >= c[1] ? 1 : -1) * crushUp * 0.55 * Math.sin(i * 9.17 + prog * 12.0)
              localStress = Math.min(1, 0.80 + 0.20 * deflateProg)
            } else {
              vz -= tireRadiusEst * 0.24 * deflateProg
              localStress = 0.55 * deflateProg
            }
          } else {
            // Rigid car body/glass/spoiler stays intact and drops lower onto the deflated rims!
            const drop = tireRadiusEst * 0.24 * deflateProg
            const pitchNoseDown = ((vx - c[0]) / Math.max(spanX, 1)) * (tireRadiusEst * 0.08) * deflateProg
            vz -= (drop + pitchNoseDown)
            localStress = 0.18 * deflateProg
          }
        }
      } else {
        // Frontal Concrete Wall or Center Bollard Pole (Stationary Obstacle at fixedWallCoord!)
        let primary = (crashAxis === 2 ? vz : (crashAxis === 0 ? vx : vy)) + approachShift
        if (crashAxis === 2) vz = primary
        else if (crashAxis === 0) vx = primary
        else vy = primary

        const latCoord = crashAxis === 0 ? (vy - c[1]) : (vx - c[0])
        const latSpan = Math.max(crashAxis === 0 ? spanY : spanX, 1)
        const poleRadius = latSpan * 0.16
        const distFromPoleCenter = Math.abs(latCoord)
        const inContact = obstacle === 'bollard_pole' ? distFromPoleCenter < poleRadius : true

        if (impactPhase > 0 && primary > fixedWallCoord) {
          const pen = primary - fixedWallCoord
          if (inContact) {
            if (failureMode === 'brittle_shatter' || role === 2) {
              // Brittle shatter (Glass / PLA): fragments scatter outward and downward!
              const hash = Math.sin(i * 12.9898) * 43758.5453
              const frac = hash - Math.floor(hash)
              const clamped = fixedWallCoord - frac * pen * 0.25
              if (crashAxis === 2) vz = clamped
              else if (crashAxis === 0) vx = clamped
              else vy = clamped
              vy += (vy >= c[1] ? 1 : -1) * pen * (0.45 + frac * 0.75)
              vz += (frac - 0.35) * pen * 0.5
            } else {
              // Ductile accordion crumple against stationary barrier + hood buckling upward
              const foldWave = Math.sin((pen / Math.max(frontSpan * 0.04, 1)) * Math.PI * 2) * 0.12
              const clamped = fixedWallCoord - Math.abs(foldWave) * (frontSpan * 0.015)
              if (crashAxis === 2) {
                vz = clamped
                vx += (vx - c[0]) * (0.32 + foldWave) * (pen / frontSpan)
                vy += (vy - c[1]) * (0.32 + foldWave) * (pen / frontSpan)
              } else if (crashAxis === 0) {
                vx = clamped
                vy += (vy >= c[1] ? 1 : -1) * pen * (0.18 + foldWave)
                vz += Math.max(0, (vz - p.mn[2]) / Math.max(spanZ, 1)) * pen * (0.28 + Math.abs(foldWave))
              } else {
                vy = clamped
                vx += (vx >= c[0] ? 1 : -1) * pen * (0.18 + foldWave)
              }
            }
            localStress = Math.min(1, 0.65 + (pen / (crumpleRatio * frontSpan + 1e-3)) * 0.50)
          } else if (obstacle === 'bollard_pole') {
            // Left and right fenders advance past the pole while wrapping inward toward center!
            const wrapFactor = Math.exp(-(distFromPoleCenter - poleRadius) / (latSpan * 0.28))
            const dragBack = pen * wrapFactor * 0.82
            if (crashAxis === 2) vz -= dragBack
            else if (crashAxis === 0) {
              vx -= dragBack
              vy -= Math.sign(latCoord) * pen * wrapFactor * 0.22
            } else {
              vy -= dragBack
            }
            localStress = Math.min(0.92, wrapFactor * 0.90)
          }
        } else if (impactPhase > 0) {
          const distToWall = Math.max(0, fixedWallCoord - primary)
          const decay = Math.exp(-distToWall / (frontSpan * 0.25))
          localStress = decay * impactPhase * (role === 2 ? 0.85 : 0.65)
        }
      }
      vStress[i] = localStress
    }

    const x = vx - c[0], y = vy - c[1], z = vz - c[2]
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

  // Prepare per-part shade palettes if mesh has named sub-parts
  const partPalettes = partNames.length > 0
    ? partNames.map((pname, idx) => {
        const hex = (partColors && partColors[pname]) || DEFAULT_PART_HEX[idx % DEFAULT_PART_HEX.length]
        return shadePaletteForHex(hex, dark)
      })
    : null
  const defaultPal = shades(dark)

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
    if (simActive && vStress) {
      const avgSt = (vStress[a] + vStress[b] + vStress[d]) / 3
      Stress[t] = Math.min(63, Math.round(avgSt * 63))
    } else {
      Stress[t] = 0
    }
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
  let lastFill = ''
  let lastAlpha = 1.0
  const glassShatterActive = simActive && impactPhase > 0.12 && crumpleRatio > 0.14 && obstacle !== 'wind_and_thrust' && obstacle !== 'spike_strip'

  for (let k = 0; k < m; k++) {
    const t = order[k]
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, d = T[t * 3 + 2] * 3
    let col
    let alpha = 1.0
    let isGlassTri = false

    if (partPalettes && triPart && triPart[t] !== undefined) {
      const pIdx = triPart[t] % partPalettes.length
      const pname = (partNames[pIdx] || '').toLowerCase()
      const pHex = ((partColors && partColors[partNames[pIdx]]) || '').toLowerCase()
      if (pname.includes('glass') || pname.includes('window') || pname.includes('windshield') || pname.includes('canopy') || pHex === '#38bdf8') {
        alpha = 0.58
        isGlassTri = true
      }
      col = partPalettes[pIdx][S[t]]
    } else {
      col = defaultPal[S[t]]
    }

    // Only override with Heatmap colors if user toggled `showHeatmap = true`!
    if (simActive && showHeatmap && Stress[t] > 6) {
      col = HEATMAP_PALETTE[Stress[t]]
      alpha = 1.0
    }

    if (alpha !== lastAlpha) {
      lastAlpha = alpha
      ctx.globalAlpha = alpha
    }
    if (col !== lastFill) {
      lastFill = col
      ctx.fillStyle = col
      ctx.strokeStyle = col
    }

    // Per-Triangle Glass Shard Explosion when glass shatters on impact!
    if ((isGlassTri || failureMode === 'brittle_shatter') && glassShatterActive && Stress[t] > 10) {
      const shardSeed = Math.sin(t * 19.31 + 1.7) * 43758.5453
      const rnd = shardSeed - Math.floor(shardSeed)
      const burst = impactPhase * (crumpleRatio * 2.2) * (0.4 + rnd * 1.4) * Math.min(w, h) * 0.14
      const nxScreen = N[t * 3] * cy - N[t * 3 + 1] * sy
      const nyScreen = -((N[t * 3] * sy + N[t * 3 + 1] * cy) * sp + N[t * 3 + 2] * cp)
      const dxShard = nxScreen * burst + (rnd - 0.5) * burst * 0.8
      const dyShard = nyScreen * burst + (impactPhase * impactPhase) * burst * 0.9 // gravity drop
      const cxTri = (P[a] + P[b] + P[d]) / 3 + dxShard
      const cyTri = (P[a + 1] + P[b + 1] + P[d + 1]) / 3 + dyShard
      const shrink = 0.72 // separate shards visually
      ctx.beginPath()
      ctx.moveTo(cxTri + (P[a] - (P[a] + P[b] + P[d]) / 3) * shrink, cyTri + (P[a + 1] - (P[a + 1] + P[b + 1] + P[d + 1]) / 3) * shrink)
      ctx.lineTo(cxTri + (P[b] - (P[a] + P[b] + P[d]) / 3) * shrink, cyTri + (P[b + 1] - (P[a + 1] + P[b + 1] + P[d + 1]) / 3) * shrink)
      ctx.lineTo(cxTri + (P[d] - (P[a] + P[b] + P[d]) / 3) * shrink, cyTri + (P[d + 1] - (P[a + 1] + P[b + 1] + P[d + 1]) / 3) * shrink)
      ctx.closePath()
      ctx.fill()
      continue
    }

    ctx.beginPath()
    ctx.moveTo(P[a], P[a + 1]); ctx.lineTo(P[b], P[b + 1]); ctx.lineTo(P[d], P[d + 1])
    ctx.closePath()
    ctx.fill()
    if (seam && alpha === 1.0) ctx.stroke()
  }
  ctx.globalAlpha = 1.0

  // Draw Stationary 3D Obstacle Overlay at `fixedWallCoord`
  if (simActive) {
    const pr = makeProj(p, w, h, { yaw, pitch, zoom })
    ctx.save()
    if (obstacle === 'concrete_wall') {
      let corners
      if (crashAxis === 2) {
        corners = [
          pr(p.mn[0] - spanX * 0.35, p.mn[1] - spanY * 0.35, fixedWallCoord),
          pr(p.mx[0] + spanX * 0.35, p.mn[1] - spanY * 0.35, fixedWallCoord),
          pr(p.mx[0] + spanX * 0.35, p.mx[1] + spanY * 0.35, fixedWallCoord),
          pr(p.mn[0] - spanX * 0.35, p.mx[1] + spanY * 0.35, fixedWallCoord),
        ]
      } else if (crashAxis === 0) {
        corners = [
          pr(fixedWallCoord, p.mn[1] - spanY * 0.25, p.mn[2]),
          pr(fixedWallCoord, p.mx[1] + spanY * 0.25, p.mn[2]),
          pr(fixedWallCoord, p.mx[1] + spanY * 0.25, p.mx[2] + spanZ * 0.25),
          pr(fixedWallCoord, p.mn[1] - spanY * 0.25, p.mx[2] + spanZ * 0.25),
        ]
      } else {
        corners = [
          pr(p.mn[0] - spanX * 0.25, fixedWallCoord, p.mn[2]),
          pr(p.mx[0] + spanX * 0.25, fixedWallCoord, p.mn[2]),
          pr(p.mx[0] + spanX * 0.25, fixedWallCoord, p.mx[2] + spanZ * 0.25),
          pr(p.mn[0] - spanX * 0.25, fixedWallCoord, p.mx[2] + spanZ * 0.25),
        ]
      }
      ctx.fillStyle = 'rgba(239, 68, 68, 0.22)'
      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = 2.2
      ctx.beginPath()
      corners.forEach((pt, idx) => (idx ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1])))
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    } else if (obstacle === 'bollard_pole') {
      const pX = crashAxis === 0 ? fixedWallCoord : p.c[0]
      const pY = crashAxis === 1 ? fixedWallCoord : p.c[1]
      const bot = crashAxis === 2 ? pr(p.mn[0] - spanX * 0.3, p.c[1], fixedWallCoord) : pr(pX, pY, p.mn[2])
      const top = crashAxis === 2 ? pr(p.mx[0] + spanX * 0.3, p.c[1], fixedWallCoord) : pr(pX, pY, p.mx[2] + spanZ * 0.28)
      ctx.strokeStyle = '#f59e0b'
      ctx.lineWidth = Math.max(14, diag * 0.045 * s)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(bot[0], bot[1])
      ctx.lineTo(top[0], top[1])
      ctx.stroke()
    } else if (obstacle === 'spike_strip') {
      ctx.strokeStyle = '#ef4444'
      ctx.fillStyle = '#f59e0b'
      ctx.lineWidth = 2
      const nSpikes = 9
      const spikeH = spanZ * 0.12
      for (let k = 0; k < nSpikes; k++) {
        const sy = p.mn[1] + (k / (nSpikes - 1)) * spanY
        const b1 = pr(p.c[0] - spanX * 0.03, sy, p.mn[2])
        const b2 = pr(p.c[0] + spanX * 0.03, sy, p.mn[2])
        const tip = pr(p.c[0], sy, p.mn[2] + spikeH)
        ctx.beginPath()
        ctx.moveTo(b1[0], b1[1])
        ctx.lineTo(tip[0], tip[1])
        ctx.lineTo(b2[0], b2[1])
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
    } else if (obstacle === 'wind_and_thrust') {
      ctx.strokeStyle = '#38bdf8'
      ctx.fillStyle = '#38bdf8'
      ctx.lineWidth = 2.2
      for (let k = 0; k < 5; k++) {
        const zLvl = p.mn[2] + ((k + 0.5) / 5) * spanZ
        const start = pr(p.c[0], p.mn[1] - spanY * 0.55, zLvl)
        const end = pr(p.c[0], p.mn[1] - spanY * 0.05, zLvl)
        ctx.beginPath()
        ctx.moveTo(start[0], start[1])
        ctx.lineTo(end[0], end[1])
        ctx.stroke()
        head(ctx, end, start)
      }
    }
    ctx.restore()
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
  drawMesh(c.getContext('2d'), w, h, mesh, { yaw: -0.75, pitch: 0.5, zoom: 0.88, ...o })
  return c.toDataURL('image/png')
}

export function Thumb({ mesh, alt = '3D preview', partColors = null }) {
  const dark = useDark()
  const [src, setSrc] = useState(null)
  useEffect(() => {
    if (!mesh || !mesh.verts || !mesh.verts.length) { setSrc(null); return }
    const key = `${dark ? 'd' : 'l'}_${partColors ? JSON.stringify(partColors) : ''}`
    let tc = thumbCache.get(mesh)
    if (!tc) { tc = {}; thumbCache.set(mesh, tc) }
    if (tc[key]) { setSrc(tc[key]); return }
    const id = setTimeout(() => {
      try {
        const u = thumbnail(mesh, 720, 440, { dark, partColors })
        tc[key] = u
        setSrc(u)
      } catch { setSrc(null) }
    }, 0)
    return () => clearTimeout(id)
  }, [mesh, dark, partColors])
  return src ? <img src={src} alt={alt} draggable={false} /> : null
}

/* ---------- interactive viewer ---------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

export default function MeshViewer({
  mesh, wire = false, auto = true, resetKey = 0,
  grid = false, axes = false, dims = false, measure = false, clearKey = 0, onMeasure,
  partColors = null, simState = null
}) {
  const cv = useRef(null)
  const S = useRef({ yaw: -0.75, pitch: 0.5, zoom: 1, drag: false, dirty: true, hover: -1, pts: [] })
  const opt = useRef({})
  opt.current = { wire, auto, grid, axes, dims, measure, partColors, simState }
  const cb = useRef(onMeasure)
  cb.current = onMeasure
  const dark = useDark()
  const darkRef = useRef(dark)
  darkRef.current = dark
  const ptrs = useRef(new Map())
  const pinch = useRef(0)
  const down = useRef(null)

  useEffect(() => { Object.assign(S.current, { yaw: -0.75, pitch: 0.5, zoom: 1, dirty: true }) }, [resetKey])
  useEffect(() => { S.current.dirty = true }, [wire, grid, axes, dims, measure, dark, partColors, simState])
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
      if (opt.current.auto && !s.drag && !(opt.current.simState && opt.current.simState.running)) {
        s.yaw += 0.006
        s.dirty = true
      }
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
        drawMesh(ctx, w, h, mesh, {
          ...view,
          wire: o.wire,
          dark: dk,
          acc,
          partColors: o.partColors,
          sim: o.simState
        })
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
    if (!p) {
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