import PageHeader from "../components/PageHeader.jsx";

const SERVICES = [
  ["Generation API", "operational", "99.98%"],
  ["brepline-1", "operational", "99.97%"],
  ["brepline-1-fast", "operational", "99.99%"],
  ["brepline-fea (beta)", "degraded", "98.60%"],
  ["Webhooks", "operational", "99.95%"],
  ["File downloads", "operational", "100%"],
];
const days = Array.from({ length: 45 }, (_, i) => (i === 12 || i === 31 ? "warn" : "ok"));

export default function Status() {
  return (
    <>
      <PageHeader eyebrow="Developers" title="Sys" accent="tem status" sub="Live health of the Brepline engine and supporting services." />
      <div className="notice">Heads up: brepline-fea is experiencing elevated latency. We're investigating.</div>
      <div className="grid g3">
        <div className="stat"><div className="stat-l">Uptime (30d)</div><div className="stat-v">99.96<small>%</small></div></div>
        <div className="stat"><div className="stat-l">Avg response</div><div className="stat-v">3.8<small>s</small></div></div>
        <div className="stat"><div className="stat-l">Incidents (30d)</div><div className="stat-v">2</div></div>
      </div>

      <div className="section-l">Services</div>
      <div className="card"><div className="card-b flush"><div className="table-wrap flat">
        <table className="table"><thead><tr><th>Service</th><th>Status</th><th className="right">Uptime 30d</th></tr></thead>
          <tbody>{SERVICES.map(([n, s, u]) => (<tr key={n}><td className="strong">{n}</td>
            <td><span className="status-ok"><i className="dot" style={{ background: s === "operational" ? "var(--green)" : "var(--orange)" }} />{s}</span></td>
            <td className="right mono">{u}</td></tr>))}</tbody></table>
      </div></div></div>

      <div className="section-l">Last 45 days</div>
      <div className="card"><div className="card-b">
        <div style={{ display: "flex", gap: 3 }}>{days.map((d, i) => (
          <i key={i} title={d === "ok" ? "No incidents" : "Partial degradation"} style={{ flex: 1, height: 28, borderRadius: 2, background: d === "ok" ? "var(--green)" : "var(--orange)", opacity: d === "ok" ? 0.75 : 1 }} />))}</div>
        <div className="row" style={{ justifyContent: "space-between" }}><span className="muted">45 days ago</span><span className="muted">Today</span></div>
      </div></div>

      <div className="section-l">Recent incidents</div>
      <ul className="card log">
        <li><span className="log-d">Oct 14</span><span><b className="strong">Elevated latency on brepline-fea</b> — Ongoing, investigating.</span></li>
        <li><span className="log-d">Oct 2</span><span><b className="strong">Webhook delivery delays</b> — Resolved in 22 minutes.</span></li>
        <li><span className="log-d">Sep 18</span><span><b className="strong">Intermittent 502 errors</b> — Resolved in 9 minutes.</span></li>
      </ul>
    </>
  );
}
