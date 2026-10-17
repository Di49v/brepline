import { useState } from "react";
import PageHeader from "../components/PageHeader.jsx";
import Code, { CopyButton } from "../components/Code.jsx";
import Icon from "../components/Icon.jsx";
import { useToast } from "../components/Toast.jsx";
import { WEBHOOK_EVENTS } from "../lib/docs.js";
import { randomId, useLocalStorage } from "../lib/storage.js";

const SAMPLE = `{
  "type": "generation.completed",
  "created_at": "2026-10-16T04:21:12Z",
  "data": {
    "id": "gen_8f2a91c4",
    "status": "complete",
    "download_url": "https://files.brepline.com/gen_8f2a91c4.step"
  }
}`;

export default function Webhooks() {
  const [cfg, setCfg] = useLocalStorage("bp_webhook", {
    url: "",
    events: ["generation.completed", "generation.failed"],
    secret: randomId("whsec_", 32),
  });
  const [reveal, setReveal] = useState(false);
  const toast = useToast();

  const toggle = (e) =>
    setCfg({ ...cfg, events: cfg.events.includes(e) ? cfg.events.filter((x) => x !== e) : [...cfg.events, e] });
  const valid = /^https:\/\/.+\..+/.test(cfg.url);

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Webhook"
        accent="endpoints"
        sub="Get an HTTPS callback the moment a part finishes. No polling needed."
      />

      <div className="grid g2">
        <section className="card">
          <div className="card-h">
            <h2>Endpoint</h2>
            <span className={`badge ${valid ? "green" : ""}`}>{valid ? "Ready" : "Not set"}</span>
          </div>
          <div className="card-b">
            <label className="field">
              <span>Endpoint URL</span>
              <input
                className="input mono"
                placeholder="https://yourapp.com/webhooks/brepline"
                value={cfg.url}
                onChange={(e) => setCfg({ ...cfg, url: e.target.value })}
              />
              {cfg.url && !valid && <em className="err">Must be a valid https:// URL</em>}
            </label>

            <div className="field">
              <span>Events</span>
              {WEBHOOK_EVENTS.map(([e, d]) => (
                <label className="check" key={e}>
                  <input type="checkbox" checked={cfg.events.includes(e)} onChange={() => toggle(e)} />
                  <i /> <code className="inline">{e}</code> <em>{d}</em>
                </label>
              ))}
            </div>

            <div className="field">
              <span>Signing secret</span>
              <div className="secret">
                <code>{reveal ? cfg.secret : cfg.secret.slice(0, 8) + "•".repeat(24)}</code>
                <button className="btn sm" onClick={() => setReveal(!reveal)}>
                  {reveal ? "Hide" : "Reveal"}
                </button>
                <CopyButton text={cfg.secret} />
              </div>
            </div>

            <div className="row">
              <button className="btn primary" disabled={!valid} onClick={() => toast("Webhook saved")}>
                Save endpoint
              </button>
              <button className="btn" disabled={!valid} onClick={() => toast("Test event sent")}>
                <Icon name="bolt" size={12} /> Send test event
              </button>
              <button className="btn danger" onClick={() => setCfg({ ...cfg, secret: randomId("whsec_", 32) })}>
                Roll secret
              </button>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-h">
            <h2>Sample payload</h2>
          </div>
          <div className="card-b flush">
            <Code lang="json" title="POST your-endpoint" code={SAMPLE} />
          </div>
          <div className="card-b">
            <p className="hint" style={{ margin: 0 }}>
              Verify the <code className="inline">Brepline-Signature</code> header against the raw request body before trusting
              a payload. See the docs for a Node example.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
