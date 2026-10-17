import { useState } from "react";
import PageHeader from "../components/PageHeader.jsx";
import Icon from "../components/Icon.jsx";
import { useToast } from "../components/Toast.jsx";

// Placeholder pricing. Replace with your real plans.
const PLANS = [
  { name: "Free", m: 0, credits: "50 credits / mo", rate: "10 req / min", cta: "Current plan", current: true,
    feats: ["STEP and STL export", "Test and live keys", "Community support"] },
  { name: "Pro", m: 29, credits: "1,000 credits / mo", rate: "60 req / min", cta: "Upgrade to Pro", hot: true,
    feats: ["Everything in Free", "Webhooks", "All materials", "Email support"] },
  { name: "Scale", m: 99, credits: "5,000 credits / mo", rate: "300 req / min", cta: "Upgrade to Scale",
    feats: ["Everything in Pro", "Priority queue", "Usage exports", "Priority support"] },
  { name: "Enterprise", m: null, credits: "Custom volume", rate: "Custom", cta: "Contact sales",
    feats: ["Dedicated capacity", "SSO and audit logs", "SLA", "Custom contracts"] },
];

const FAQ = [
  ["What is a credit?", "One successful generation uses one credit. Failed generations are never charged."],
  ["Do test keys use credits?", "No. Test keys run against the sandbox and are free."],
  ["Can I change plans anytime?", "Yes. Upgrades apply immediately and downgrades at the end of the billing period."],
];

export default function Pricing() {
  const [yearly, setYearly] = useState(false);
  const toast = useToast();

  return (
    <>
      <PageHeader eyebrow="Account" title="Simple," accent="usage-based pricing" sub="Start free. Pay only when you outgrow it." />

      <div className="seg center">
        <button className={!yearly ? "on" : ""} onClick={() => setYearly(false)}>
          Monthly
        </button>
        <button className={yearly ? "on" : ""} onClick={() => setYearly(true)}>
          Yearly <span className="save">-20%</span>
        </button>
      </div>

      <div className="grid g4 plans">
        {PLANS.map((p) => {
          const price = p.m === null ? "Custom" : `$${yearly ? Math.round(p.m * 0.8) : p.m}`;
          return (
            <section className={`card plan ${p.hot ? "hot" : ""}`} key={p.name}>
              {p.hot && <span className="ribbon">Popular</span>}
              <h3>{p.name}</h3>
              <div className="price">
                {price}
                {p.m !== null && <small>/ mo</small>}
              </div>
              <div className="plan-meta">
                <span>{p.credits}</span>
                <span>{p.rate}</span>
              </div>
              <ul>
                {p.feats.map((f) => (
                  <li key={f}>
                    <Icon name="check" size={12} /> {f}
                  </li>
                ))}
              </ul>
              <button
                className={`btn block ${p.hot ? "primary" : ""}`}
                disabled={p.current}
                onClick={() => toast("Connect your billing provider to enable upgrades")}
              >
                {p.cta}
              </button>
            </section>
          );
        })}
      </div>

      <div className="section-l">FAQ</div>
      <div className="grid g3">
        {FAQ.map(([q, a]) => (
          <div className="card faq" key={q}>
            <h3>{q}</h3>
            <p>{a}</p>
          </div>
        ))}
      </div>
    </>
  );
}
