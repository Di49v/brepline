/* Shared 2D overlay for the 3D pop-up viewer: XYZ axis arrows + a scale bar in mm.
   Call it at the end of every frame, after the model is drawn.
     x        2D canvas context
     W, H     canvas size in device pixels
     r        devicePixelRatio
     pxPerMm  screen pixels per model millimetre (at the model centre)
     rot      (X, Y, Z) => [sx, sy, depth]   the viewer's current rotation
     color    text/line colour (theme aware)  */

const AXES = [
  { l: 'X', v: [1, 0, 0], c: '#e5484d' },
  { l: 'Y', v: [0, 1, 0], c: '#30a46c' },
  { l: 'Z', v: [0, 0, 1], c: '#3e7bff' }
]

// 1 / 2 / 5 x 10^n
const niceMm = t => {
  const p = 10 ** Math.floor(Math.log10(t))
  const f = t / p
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p
}
const label = mm => (mm >= 1000 ? Number((mm / 1000).toPrecision(3)) + ' m' : Number(mm.toPrecision(3)) + ' mm')

export function drawOverlay(x, { W, H, r, pxPerMm, rot, color = '#888' }) {
  x.save()
  x.lineCap = 'round'
  x.lineJoin = 'round'
  x.font = `600 ${11 * r}px Inter, system-ui, sans-serif`
  x.textAlign = 'center'
  x.textBaseline = 'middle'

  /* axis triad, bottom-left */
  const L = 40 * r
  const ox = 22 * r + L
  const oy = H - 22 * r - L
  AXES.map(a => ({ ...a, p: rot(...a.v) }))
    .sort((a, b) => a.p[2] - b.p[2]) // far first, near last
    .forEach(({ l, p, c }) => {
      const ex = ox + p[0] * L
      const ey = oy - p[1] * L
      const len = Math.hypot(ex - ox, ey - oy)
      x.strokeStyle = c
      x.fillStyle = c
      x.lineWidth = 2 * r
      x.beginPath()
      x.moveTo(ox, oy)
      x.lineTo(ex, ey)
      x.stroke()
      if (len > 7 * r) {
        const ang = Math.atan2(ey - oy, ex - ox)
        const h = 7 * r
        x.beginPath()
        x.moveTo(ex, ey)
        x.lineTo(ex - h * Math.cos(ang - 0.45), ey - h * Math.sin(ang - 0.45))
        x.lineTo(ex - h * Math.cos(ang + 0.45), ey - h * Math.sin(ang + 0.45))
        x.closePath()
        x.fill()
      } else {
        // axis points almost straight at / away from the viewer
        x.beginPath()
        x.arc(ex, ey, 3 * r, 0, Math.PI * 2)
        x.fill()
      }
      const k = len > 1 ? 13 * r / len : 0
      x.fillText(l, ex + (ex - ox) * k + (len > 1 ? 0 : 10 * r), ey + (ey - oy) * k - (len > 1 ? 0 : 10 * r))
    })
  x.fillStyle = color
  x.beginPath()
  x.arc(ox, oy, 2.5 * r, 0, Math.PI * 2)
  x.fill()

  /* scale bar, bottom-right */
  if (pxPerMm > 0) {
    const mm = niceMm((110 * r) / pxPerMm)
    const w = mm * pxPerMm
    const x1 = W - 22 * r
    const x0 = x1 - w
    const y = H - 26 * r
    x.strokeStyle = color
    x.lineWidth = 1.5 * r
    x.beginPath()
    x.moveTo(x0, y - 5 * r); x.lineTo(x0, y); x.lineTo(x1, y); x.lineTo(x1, y - 5 * r)
    x.stroke()
    x.fillStyle = color
    x.fillText(label(mm), (x0 + x1) / 2, y - 12 * r)
  }
  x.restore()
}