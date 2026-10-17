import { useMemo, useState } from "react";
import PageHeader from "../components/PageHeader.jsx";
import { PLAN } from "../lib/config.js";

// Deterministic demo data. Replace with GET /usage from your backend.
function series(days) {
  let s = 7;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5);
    const ok = Math.floor(rnd() * 14);
    const fail = rnd() > 0.75 ? Math.floor(rnd() * 3) : 0;
    out.push({ label: d.toLocaleDateString("en", { month: "short", day: "numeric" }), ok, fail });
  }
  return out;
}

const LOG = [
  ["POST", "/generate", 200, "1.6s", "bp_live_…k3x9", "2 min ago"],
  ["POST", "/generate", 200, "2.1s", "bp_live_…k3x9", "14 min ago"],
  ["GET", "/generations/gen_8f2a", 200, "84ms", "bp_test_…q7m2", "1 h ago"],
  ["POST", "/generate", 422, "1.2s", "bp_live_…k3x9", "3 h ago"],
  ["POST", "/generate", 429, "12ms", "bp_test_…q7m2", "5 h ago"],
  ["GET", "/usage", 200, "61ms", "bp_live_…k3x9", "1 d ago"],
];

export default function Usage() {
  const [range, setRange] = useState(14);
  const data = useMemo(() => series(range), [range]);
  const max = Math.max(...data.map((d) => d.ok + d.fail), 1);
  const total = data.reduce((a, d) => a + d.ok + d.fail, 0);
  const fails = data.reduce((a, d) => a + d.fail, 0);
  const pct = Math.round((PLAN.used / PLAN.credits) * 100);

  const W = 760,
    H = 200,
    pad = 24,
    bw = (W - pad * 2) / data.length;

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="API"
        accent="usage"
        sub="Requests, errors and credits for your keys."
        actions={
          <div className="seg">
            {[7, 14, 30].map((r) => (
              <button key={r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>
                {r}d
              </button>
            ))}
          </div>
        }
      />

      <div className="grid g4">
        <div className="stat">
          <div className="stat-l">Requests</div>
          <div className="stat-v">{total}</div>
          <div className="stat-s">Last {range} days</div>
        </div>
        <div className="stat">
          <div className="stat-l">Success rate</div>
          <div className="stat-v">
            {total ? (((total - fails) / total) * 100).toFixed(1) : "100"}
            <small>%</small>
          </div>
          <div className="stat-s">{fails} failed</div>
        </div>
        <div className="stat">
          <div className="stat-l">Credits</div>
          <div className="stat-v">
            {PLAN.used}
            <small>/ {PLAN.credits}</small>
          </div>
          <div className="bar">
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="stat">
          <div className="stat-l">p95 latency</div>
          <div className="stat-v">
            2.9<small>s</small>
          </div>
          <div className="stat-s">Generate endpoint</div>
        </div>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-h">
          <h2>Requests per day</h2>
          <span className="legend">
            <i className="lg-o" /> Success <i className="lg-r" /> Failed
          </span>
        </div>
        <div className="card-b">
          <svg viewBox={`0 0 ${W} ${H + 24}`} className="chart" role="img" aria-label="Requests per day">
            {[0, 0.5, 1].map((t) => (
              <g key={t}>
                <line x1={pad} x2={W - pad} y1={H - t * (H - 10)} y2={H - t * (H - 10)} className="grid-l" />
                <text x={0} y={H - t * (H - 10) + 3} className="ax">
                  {Math.round(max * t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const h1 = (d.ok / max) * (H - 10);
              const h2 = (d.fail / max) * (H - 10);
              const x = pad + i * bw + bw * 0.18;
              const w = bw * 0.64;
              return (
                <g key={i}>
                  <rect x={x} y={H - h1} width={w} height={h1} className="bar-o" />
                  {h2 > 0 && <rect x={x} y={H - h1 - h2} width={w} height={h2} className="bar-r" />}
                  {(range <= 14 || i % 3 === 0) && (
                    <text x={x + w / 2} y={H + 16} textAnchor="middle" className="ax">
                      {d.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-h">
          <h2>Recent requests</h2>
        </div>
        <div className="table-wrap flat">
          <table className="table">
            <thead>
              <tr>
                <th>Method</th>
                <th>Path</th>
                <th>Status</th>
                <th>Latency</th>
                <th>Key</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {LOG.map((r, i) => (
                <tr key={i}>
                  <td>
                    <span className={`method ${r[0]}`}>{r[0]}</span>
                  </td>
                  <td className="mono">{r[1]}</td>
                  <td>
                    <span className={`badge ${r[2] < 300 ? "green" : r[2] < 500 ? "orange" : "red"}`}>{r[2]}</span>
                  </td>
                  <td className="muted">{r[3]}</td>
                  <td className="mono muted">{r[4]}</td>
                  <td className="muted">{r[5]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
