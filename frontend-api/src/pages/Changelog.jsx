import PageHeader from "../components/PageHeader.jsx";

const ENTRIES = [
  { v: "v1.4.0", d: "Oct 12", tag: "New", items: ["brepline-fea beta: load-aware generation with stress reports", "Webhook retries with exponential backoff", "Team roles: Admin, Developer, Viewer"] },
  { v: "v1.3.2", d: "Sep 28", tag: "Improved", items: ["~30% faster brepline-1 on parts with 10+ features", "Better fillet and chamfer handling on thin walls"] },
  { v: "v1.3.0", d: "Sep 9", tag: "New", items: ["brepline-1-fast model", "STL export alongside STEP", "Usage dashboard with per-key breakdown"] },
  { v: "v1.2.1", d: "Aug 21", tag: "Fixed", items: ["Intermittent 502s on large assemblies", "Incorrect units when prompt mixed mm and inches"] },
];

export default function Changelog() {
  return (
    <>
      <PageHeader eyebrow="Developers" title="Change" accent="log" sub="New models, features, and fixes shipped to the Brepline API." />
      <div className="grid" style={{ gap: 14 }}>
        {ENTRIES.map(e => (
          <div key={e.v} className="card">
            <div className="card-h"><h2>{e.v}</h2><div className="row"><span className={"badge " + (e.tag === "New" ? "orange" : e.tag === "Fixed" ? "green" : "")}>{e.tag}</span><span className="muted mono">{e.d}</span></div></div>
            <ul className="feat">{e.items.map(i => <li key={i}><span className="feat-i">+</span><span style={{ alignSelf: "center" }}>{i}</span></li>)}</ul>
          </div>))}
      </div>
    </>
  );
}
