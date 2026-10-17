import { Link } from "react-router-dom";
import PageHeader from "../components/PageHeader.jsx";
import Code from "../components/Code.jsx";
import Icon from "../components/Icon.jsx";
import { buildSnippets } from "../lib/snippets.js";
import { BASE_URL, PLAN } from "../lib/config.js";
import { CHANGELOG } from "../lib/docs.js";
import { useLocalStorage } from "../lib/storage.js";

const STEPS = [
  { n: "01", t: "Create a key", d: "Generate a secret key. Keep it on your server.", to: "/keys?new=1", cta: "Create key" },
  { n: "02", t: "Try a request", d: "Describe a part and see the response live.", to: "/playground", cta: "Open playground" },
  { n: "03", t: "Ship it", d: "Copy the snippet into your app. Done.", to: "/docs", cta: "Read the docs" },
];

export default function Overview() {
  const [keys] = useLocalStorage("bp_keys", []);
  const pct = Math.round((PLAN.used / PLAN.credits) * 100);

  return (
    <>
      <PageHeader
        eyebrow="Developers"
        title="Build with the"
        accent="Brepline API"
        sub="Describe a part, get production-ready 3D CAD back. Generate STEP and STL files from your own apps with a single request."
        actions={
          <>
            <Link to="/docs" className="btn">
              <Icon name="book" size={13} /> Docs
            </Link>
            <Link to="/keys?new=1" className="btn primary">
              <Icon name="plus" size={13} /> New key
            </Link>
          </>
        }
      />

      <div className="grid g4">
        <div className="stat">
          <div className="stat-l">Credits used</div>
          <div className="stat-v">
            {PLAN.used}
            <small>/ {PLAN.credits}</small>
          </div>
          <div className="bar">
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="stat">
          <div className="stat-l">Active keys</div>
          <div className="stat-v">{keys.length}</div>
          <div className="stat-s">Live and test</div>
        </div>
        <div className="stat">
          <div className="stat-l">Rate limit</div>
          <div className="stat-v">
            {PLAN.rate}
            <small>req / min</small>
          </div>
          <div className="stat-s">Upgrade for more</div>
        </div>
        <div className="stat">
          <div className="stat-l">Avg latency</div>
          <div className="stat-v">
            1.8<small>s</small>
          </div>
          <div className="stat-s">Last 24 hours</div>
        </div>
      </div>

      <div className="section-l">Get started</div>
      <div className="grid g3">
        {STEPS.map((s) => (
          <Link to={s.to} className="step card hover" key={s.n}>
            <span className="step-n">{s.n}</span>
            <h3>{s.t}</h3>
            <p>{s.d}</p>
            <span className="step-cta">
              {s.cta} <Icon name="arrow" size={12} />
            </span>
          </Link>
        ))}
      </div>

      <div className="section-l">Quickstart</div>
      <Code tabs={buildSnippets()} />
      <p className="hint">
        Base URL <code className="inline">{BASE_URL}</code> · Authenticate with{" "}
        <code className="inline">Authorization: Bearer YOUR_API_KEY</code>
      </p>

      <div className="grid g2" style={{ marginTop: 24 }}>
        <section className="card">
          <div className="card-h">
            <h2>Capabilities</h2>
          </div>
          <ul className="feat">
            {[
              ["cube", "Text to CAD", "Parametric parts from plain language."],
              ["download", "STEP and STL", "Open in Fusion, SolidWorks or slice and print."],
              ["bolt", "Webhooks", "Get notified the moment a part is ready."],
              ["shield", "Scoped keys", "Separate test and live keys with permissions."],
            ].map(([i, t, d]) => (
              <li key={t}>
                <span className="feat-i">
                  <Icon name={i} size={14} />
                </span>
                <div>
                  <b>{t}</b>
                  <span>{d}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <div className="card-h">
            <h2>Changelog</h2>
            <Link to="/docs" className="link">
              View all
            </Link>
          </div>
          <ul className="log">
            {CHANGELOG.map(([d, t]) => (
              <li key={d}>
                <span className="log-d">{d}</span>
                {t}
              </li>
            ))}
          </ul>
          <div className="card-h" style={{ borderTop: "1px solid var(--border)" }}>
            <h2>System status</h2>
            <span className="status-ok">
              <i className="dot" /> All systems operational
            </span>
          </div>
        </section>
      </div>
    </>
  );
}
