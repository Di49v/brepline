import PageHeader from "../components/PageHeader.jsx";

const MODELS = [
  { id: "brepline-1", tag: "Flagship", badge: "orange", desc: "Full text-to-CAD. Generates clean B-Rep solids with parametric features, ready for STEP export.", lat: "~4s", out: "STEP · STL · BREP", ctx: "2,000 chars", price: "$0.04 / model" },
  { id: "brepline-1-fast", tag: "Fast", badge: "green", desc: "Lower-latency variant for rapid iteration and previews. Slightly less feature detail on complex parts.", lat: "~1.3s", out: "STEP · STL", ctx: "1,000 chars", price: "$0.01 / model" },
  { id: "brepline-fea", tag: "Beta", badge: "", desc: "Load-aware generation. Accepts constraints and loads, runs FEA, and returns the part with a stress report.", lat: "~9s", out: "STEP · STL · JSON report", ctx: "3,000 chars", price: "$0.12 / model" },
];

export default function Models() {
  return (
    <>
      <PageHeader eyebrow="Developers" title="Mod" accent="els" sub="Pick the engine that fits your workflow. Pass the model ID in the model field of any request." />
      <div className="grid g3">
        {MODELS.map(m => (
          <div key={m.id} className="card hover">
            <div className="card-h"><h2>{m.id}</h2><span className={"badge " + m.badge}>{m.tag}</span></div>
            <div className="card-b">
              <p className="muted">{m.desc}</p>
              <ul className="feat" style={{ margin: "0 -16px" }}>
                {[["Latency", m.lat], ["Outputs", m.out], ["Prompt limit", m.ctx], ["Price", m.price]].map(([k, v]) => (
                  <li key={k} style={{ justifyContent: "space-between" }}><span className="muted">{k}</span><span className="mono">{v}</span></li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      <div className="section-l">Quick start</div>
      <div className="code">
        <div className="code-bar"><span className="code-title">curl</span></div>
        <pre>{`curl https://api.brepline.com/v1/generate \\
  -H "Authorization: Bearer $BREPLINE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "brepline-1",
    "prompt": "M8 flange bracket with 4 mounting holes",
    "format": "step"
  }'`}</pre>
      </div>
      <div className="callout"><span>ⓘ</span><span><b>Not sure which to use?</b> Start with <code className="inline">brepline-1-fast</code> while prototyping, then switch to <code className="inline">brepline-1</code> for production output.</span></div>
    </>
  );
}
