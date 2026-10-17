import { useState } from "react";
import PageHeader from "../components/PageHeader.jsx";

export default function Settings() {
  const [tab, setTab] = useState("General");
  const [saved, setSaved] = useState(false);
  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 1800); };
  return (
    <>
      <PageHeader eyebrow="Account" title="Set" accent="tings" sub="Workspace preferences, defaults for new requests, and notifications.">
        <button className="btn primary" onClick={save}>{saved ? "Saved ✓" : "Save changes"}</button>
      </PageHeader>
      <div className="seg" style={{ marginBottom: 16 }}>{["General", "Defaults", "Notifications", "Danger zone"].map(t => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}</div>

      {tab === "General" && <div className="card"><div className="card-h"><h2>Profile</h2></div><div className="card-b">
        <div className="grid g2">
          <label className="field"><span>Display name</span><input className="input" defaultValue="Tegkirat" /></label>
          <label className="field"><span>Email</span><input className="input" defaultValue="you@brepline.com" /></label>
          <label className="field"><span>Workspace</span><input className="input" defaultValue="Brepline" /></label>
          <label className="field"><span>Timezone</span><select className="input"><option>Asia/Kolkata (IST)</option><option>UTC</option><option>America/New_York</option></select></label>
        </div></div></div>}

      {tab === "Defaults" && <div className="card"><div className="card-h"><h2>Request defaults</h2></div><div className="card-b">
        <div className="grid g3">
          <label className="field"><span>Default model</span><select className="input"><option>brepline-1</option><option>brepline-1-fast</option><option>brepline-fea</option></select></label>
          <label className="field"><span>Output format</span><select className="input"><option>STEP</option><option>STL</option><option>BREP</option></select></label>
          <label className="field"><span>Units</span><select className="input"><option>Millimetres</option><option>Inches</option></select></label>
        </div>
        <label className="check"><input type="checkbox" defaultChecked /><i />Include feature tree in response</label>
        <label className="check"><input type="checkbox" /><i />Always run mesh validation</label>
      </div></div>}

      {tab === "Notifications" && <div className="card"><div className="card-h"><h2>Email notifications</h2></div><div className="card-b">
        {["Failed generations", "Usage at 80% of quota", "Webhook delivery failures", "Product updates & changelog"].map((n, i) => (
          <label key={n} className="switch"><input type="checkbox" defaultChecked={i < 3} /><i />{n}</label>))}
      </div></div>}

      {tab === "Danger zone" && <div className="card" style={{ borderColor: "var(--red)" }}><div className="card-h"><h2 style={{ color: "var(--red)" }}>Danger zone</h2></div><div className="card-b">
        <p className="muted">Deleting your workspace permanently removes all keys, webhooks, and generation history. This cannot be undone.</p>
        <div><button className="btn danger">Delete workspace</button></div>
      </div></div>}
    </>
  );
}
