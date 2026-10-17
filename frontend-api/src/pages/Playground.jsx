import { useMemo, useState } from "react";
import PageHeader from "../components/PageHeader.jsx";
import Code, { CopyButton } from "../components/Code.jsx";
import Icon from "../components/Icon.jsx";
import { buildSnippets } from "../lib/snippets.js";
import { generate } from "../lib/api.js";
import { EXAMPLES, FORMATS, MATERIALS, UNITS } from "../lib/config.js";

export default function Playground() {
  const [form, setForm] = useState({
    prompt: EXAMPLES[0].text,
    material: "AL6061",
    format: "step",
    units: "mm",
  });
  const [apiKey, setApiKey] = useState("");
  const [demo, setDemo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState(null);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const snippets = useMemo(() => buildSnippets(apiKey || "YOUR_API_KEY", form), [apiKey, form]);

  const run = async () => {
    if (!form.prompt.trim() || loading) return;
    setLoading(true);
    setRes(null);
    try {
      setRes(await generate({ ...form, apiKey, demo }));
    } catch (e) {
      setRes({
        status: 0,
        ms: 0,
        data: { error: { type: "network_error", message: e.message || "Request failed. Check the base URL and CORS." } },
      });
    }
    setLoading(false);
  };

  const ok = res && res.status >= 200 && res.status < 300;

  return (
    <>
      <PageHeader
        eyebrow="Developers"
        title="API"
        accent="playground"
        sub="Describe a part, run a real request and copy the code. Demo mode works without a key."
      />

      <div className="pg">
        <section className="card">
          <div className="card-h">
            <h2>Request</h2>
            <label className="switch">
              <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
              <i /> Demo mode
            </label>
          </div>
          <div className="card-b">
            <div className="chips">
              {EXAMPLES.map((e) => (
                <button key={e.tag} className="chip" onClick={() => setForm({ ...form, prompt: e.text })}>
                  {e.tag}
                </button>
              ))}
            </div>

            <label className="field">
              <span>Prompt</span>
              <textarea
                className="input area"
                rows={4}
                value={form.prompt}
                onChange={set("prompt")}
                placeholder="Describe the part and its dimensions in mm"
              />
            </label>

            <div className="grid g3 tight">
              <label className="field">
                <span>Material</span>
                <select className="input" value={form.material} onChange={set("material")}>
                  {MATERIALS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Format</span>
                <select className="input" value={form.format} onChange={set("format")}>
                  {FORMATS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Units</span>
                <select className="input" value={form.units} onChange={set("units")}>
                  {UNITS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
            </div>

            {!demo && (
              <label className="field">
                <span>API key</span>
                <input
                  className="input mono"
                  type="password"
                  autoComplete="off"
                  placeholder="bp_test_…"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </label>
            )}

            <button className="btn primary block" onClick={run} disabled={loading || (!demo && !apiKey)}>
              {loading ? <span className="spin" /> : <Icon name="play" size={12} />}
              {loading ? "Generating…" : "Run request"}
            </button>
          </div>
        </section>

        <section className="card">
          <div className="card-h">
            <h2>Response</h2>
            {res && (
              <span className="resmeta">
                <span className={`badge ${ok ? "green" : "red"}`}>{res.status || "ERR"}</span>
                <span className="muted">{res.ms} ms</span>
              </span>
            )}
          </div>
          <div className="card-b flush">
            {!res && !loading && (
              <div className="empty small">
                <Icon name="cube" size={20} />
                <span>Run a request to see the response here.</span>
              </div>
            )}
            {loading && (
              <div className="empty small">
                <span className="spin lg" />
                <span>Building geometry…</span>
              </div>
            )}
            {res && (
              <>
                {ok && (
                  <div className="result">
                    <div className="dims">
                      {["x", "y", "z"].map((a) => (
                        <div key={a}>
                          <span>{a.toUpperCase()}</span>
                          <b>{res.data.dimensions?.[a]}</b>
                        </div>
                      ))}
                      <div>
                        <span>Units</span>
                        <b>{res.data.dimensions?.units}</b>
                      </div>
                    </div>
                    <div className="row">
                      <a className="btn sm primary" href={res.data.download_url} target="_blank" rel="noreferrer">
                        <Icon name="download" size={11} /> Download {res.data.format?.toUpperCase()}
                      </a>
                      <CopyButton text={res.data.download_url} label="Copy link" />
                    </div>
                  </div>
                )}
                <Code code={JSON.stringify(res.data, null, 2)} lang="json" title="application/json" />
              </>
            )}
          </div>
        </section>
      </div>

      <div className="section-l">Code</div>
      <Code tabs={snippets} />
    </>
  );
}
