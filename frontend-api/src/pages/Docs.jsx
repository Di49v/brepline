import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader.jsx";
import Code from "../components/Code.jsx";
import { BASE_URL } from "../lib/config.js";
import { CHANGELOG, ENDPOINTS, ERRORS, WEBHOOK_EVENTS } from "../lib/docs.js";

const TOC = [
  ["intro", "Introduction"],
  ["auth", "Authentication"],
  ["errors", "Errors"],
  ["limits", "Rate limits"],
  ...ENDPOINTS.map((e) => [e.id, e.title]),
  ["webhooks", "Webhooks"],
  ["changelog", "Changelog"],
];

function reqSnippet(e) {
  const url = `${BASE_URL}${e.path.replace("{id}", "gen_8f2a91c4")}`;
  if (e.method === "POST")
    return {
      cURL: {
        lang: "bash",
        code: `curl -X POST ${url} \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "Spur gear, 24 teeth, module 2, 10 mm bore", "format": "step"}'`,
      },
      Python: {
        lang: "python",
        code: `import requests

res = requests.post(
    "${url}",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={"prompt": "Spur gear, 24 teeth, module 2, 10 mm bore", "format": "step"},
)
print(res.json())`,
      },
      JavaScript: {
        lang: "javascript",
        code: `const res = await fetch("${url}", {
  method: "POST",
  headers: { "Authorization": "Bearer YOUR_API_KEY", "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: "Spur gear, 24 teeth, module 2, 10 mm bore", format: "step" }),
});
console.log(await res.json());`,
      },
    };
  return {
    cURL: { lang: "bash", code: `curl ${url} \\\n  -H "Authorization: Bearer YOUR_API_KEY"` },
    Python: {
      lang: "python",
      code: `import requests\n\nres = requests.get("${url}", headers={"Authorization": "Bearer YOUR_API_KEY"})\nprint(res.json())`,
    },
    JavaScript: {
      lang: "javascript",
      code: `const res = await fetch("${url}", {\n  headers: { "Authorization": "Bearer YOUR_API_KEY" },\n});\nconsole.log(await res.json());`,
    },
  };
}

export default function Docs() {
  const [active, setActive] = useState("intro");

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: "-80px 0px -70% 0px" }
    );
    TOC.forEach(([id]) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <>
      <PageHeader eyebrow="Reference" title="API" accent="documentation" sub={`REST over HTTPS. JSON in, JSON out. Base URL: ${BASE_URL}`} />

      <div className="docs">
        <article className="doc">
          <section id="intro">
            <h2>Introduction</h2>
            <p>
              The Brepline API turns a text description into a manufacturable 3D part. Send a prompt with dimensions and
              you get back a STEP or STL file. Every response is JSON and every request is authenticated with a bearer
              key.
            </p>
            <p className="warn">Generated geometry can contain mistakes. Always verify dimensions before manufacturing.</p>
          </section>

          <section id="auth">
            <h2>Authentication</h2>
            <p>
              Pass your secret key in the <code className="inline">Authorization</code> header. Keys beginning with{" "}
              <code className="inline">bp_test_</code> run against the sandbox and do not use credits.
            </p>
            <Code lang="bash" title="header" code={`Authorization: Bearer bp_live_xxxxxxxxxxxxxxxx`} />
          </section>

          <section id="errors">
            <h2>Errors</h2>
            <p>We use standard HTTP status codes. Error bodies follow one shape:</p>
            <Code
              lang="json"
              code={`{
  "error": {
    "type": "rate_limited",
    "message": "Too many requests. Retry in 12 seconds."
  }
}`}
            />
            <div className="table-wrap flat">
              <table className="table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Type</th>
                    <th>Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {ERRORS.map(([c, t, d]) => (
                    <tr key={c}>
                      <td className="mono">{c}</td>
                      <td>
                        <code className="inline">{t}</code>
                      </td>
                      <td className="muted">{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="limits">
            <h2>Rate limits</h2>
            <p>
              Limits depend on your plan. Every response includes <code className="inline">X-RateLimit-Remaining</code> and{" "}
              <code className="inline">X-RateLimit-Reset</code>. When you receive a <code className="inline">429</code>, wait for
              the <code className="inline">Retry-After</code> seconds and retry with exponential backoff.
            </p>
          </section>

          {ENDPOINTS.map((e) => (
            <section id={e.id} key={e.id}>
              <h2>{e.title}</h2>
              <div className="endpoint">
                <span className={`method ${e.method}`}>{e.method}</span>
                <code>{e.path}</code>
              </div>
              <p>{e.desc}</p>
              {e.params.length > 0 && (
                <div className="table-wrap flat">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Parameter</th>
                        <th>Type</th>
                        <th>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {e.params.map((p) => (
                        <tr key={p.name}>
                          <td>
                            <code className="inline">{p.name}</code>
                            {p.req && <span className="req">required</span>}
                          </td>
                          <td className="mono muted">{p.type}</td>
                          <td className="muted">{p.desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Code tabs={reqSnippet(e)} />
              <div className="gap" />
              <Code lang="json" title="200 response" code={e.response} />
            </section>
          ))}

          <section id="webhooks">
            <h2>Webhooks</h2>
            <p>
              Register an endpoint on the Webhooks page. We sign each delivery with the{" "}
              <code className="inline">Brepline-Signature</code> header (HMAC SHA-256 of the raw body). Respond with any 2xx to
              acknowledge.
            </p>
            <div className="table-wrap flat">
              <table className="table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {WEBHOOK_EVENTS.map(([e, d]) => (
                    <tr key={e}>
                      <td>
                        <code className="inline">{e}</code>
                      </td>
                      <td className="muted">{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Code
              lang="javascript"
              title="verify signature (node)"
              code={`import crypto from "node:crypto";

const expected = crypto
  .createHmac("sha256", process.env.BREPLINE_WEBHOOK_SECRET)
  .update(rawBody)
  .digest("hex");

if (expected !== req.headers["brepline-signature"]) throw new Error("Bad signature");`}
            />
          </section>

          <section id="changelog">
            <h2>Changelog</h2>
            <ul className="log">
              {CHANGELOG.map(([d, t]) => (
                <li key={d}>
                  <span className="log-d">{d}</span>
                  {t}
                </li>
              ))}
            </ul>
          </section>
        </article>

        <aside className="toc">
          <div className="toc-l">On this page</div>
          {TOC.map(([id, l]) => (
            <button key={id} className={active === id ? "on" : ""} onClick={() => go(id)}>
              {l}
            </button>
          ))}
        </aside>
      </div>
    </>
  );
}
