import { useState } from "react";
import PageHeader from "../components/PageHeader.jsx";

const ROWS = [
  { id: "gen_8f21a", prompt: "M8 flange bracket, 4 mounting holes, 3mm fillet", model: "brepline-1", status: "succeeded", fmt: "STEP", ms: 4210, when: "2 min ago" },
  { id: "gen_77c0e", prompt: "Spur gear, 24 teeth, module 2, 10mm bore", model: "brepline-1", status: "succeeded", fmt: "STEP", ms: 5120, when: "18 min ago" },
  { id: "gen_61b9d", prompt: "Enclosure 80x50x25 with snap-fit lid", model: "brepline-1-fast", status: "succeeded", fmt: "STL", ms: 1380, when: "1 hr ago" },
  { id: "gen_5a44f", prompt: "L-bracket under 120N load, minimise mass", model: "brepline-fea", status: "failed", fmt: "STEP", ms: 9020, when: "3 hr ago" },
  { id: "gen_4d02b", prompt: "Pipe elbow 90°, DN25, flanged ends", model: "brepline-1", status: "succeeded", fmt: "STEP", ms: 4770, when: "Yesterday" },
  { id: "gen_3be18", prompt: "Heat sink, 12 fins, 40x40 base", model: "brepline-1-fast", status: "succeeded", fmt: "STEP", ms: 1210, when: "Yesterday" },
];
const FILTERS = ["all", "succeeded", "failed"];

export default function Generations() {
  const [f, setF] = useState("all");
  const [q, setQ] = useState("");
  const rows = ROWS.filter(r => (f === "all" || r.status === f) && r.prompt.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader eyebrow="Developers" title="Gener" accent="ations" sub="Every CAD model your API keys have produced. Click a row to inspect the request and download the output.">
        <button className="btn">Export CSV</button>
      </PageHeader>

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="stat-l">Total</div><div className="stat-v">128</div><div className="stat-s">last 30 days</div></div>
        <div className="stat"><div className="stat-l">Success rate</div><div className="stat-v">94.5<small>%</small></div><div className="stat-s">7 failures</div></div>
        <div className="stat"><div className="stat-l">Median latency</div><div className="stat-v">3.9<small>s</small></div><div className="stat-s">p95 9.2s</div></div>
        <div className="stat"><div className="stat-l">Most used</div><div className="stat-v" style={{ fontSize: 15 }}>brepline-1</div><div className="stat-s">71% of requests</div></div>
      </div>

      <div className="card">
        <div className="card-h">
          <div className="seg">{FILTERS.map(x => <button key={x} className={f === x ? "on" : ""} onClick={() => setF(x)}>{x}</button>)}</div>
          <input className="input" style={{ maxWidth: 240 }} placeholder="Search prompts…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="card-b flush">
          <div className="table-wrap flat">
            <table className="table">
              <thead><tr><th>ID</th><th>Prompt</th><th>Model</th><th>Format</th><th>Latency</th><th>Status</th><th>When</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="mono">{r.id}</td>
                    <td style={{ maxWidth: 340 }}>{r.prompt}</td>
                    <td><span className="badge">{r.model}</span></td>
                    <td className="mono">{r.fmt}</td>
                    <td className="mono">{(r.ms / 1000).toFixed(1)}s</td>
                    <td><span className={"badge " + (r.status === "succeeded" ? "green" : "red")}>{r.status}</span></td>
                    <td className="muted">{r.when}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={7}><div className="empty small"><b>No matches</b>Try a different filter or search.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
