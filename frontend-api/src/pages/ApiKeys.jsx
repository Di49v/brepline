import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import PageHeader from "../components/PageHeader.jsx";
import Modal from "../components/Modal.jsx";
import Icon from "../components/Icon.jsx";
import { CopyButton } from "../components/Code.jsx";
import { useToast } from "../components/Toast.jsx";
import { timeAgo } from "../lib/storage.js";
import { listKeys, createKey, deleteKey } from "../lib/backend.js";

const SCOPES = [
  ["generate", "Generate parts"],
  ["read", "Read generations"],
  ["usage", "Read usage"],
];

export default function ApiKeys() {
  // Keys live in the backend (hashed). The full secret is shown once, then discarded.
  const [keys, setKeys] = useState([]);
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState(null);
  const [revoke, setRevoke] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", env: "live", scopes: ["generate", "read", "usage"] });
  const toast = useToast();

  const refresh = async () => {
    try {
      const d = await listKeys();
      // backend times are in seconds, timeAgo expects milliseconds
      setKeys(
        d.keys.map((k) => ({
          ...k,
          created: k.created * 1000,
          lastUsed: k.last_used ? k.last_used * 1000 : null,
        }))
      );
    } catch {
      toast("Can't reach the backend. Is uvicorn running on port 8000?");
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (params.get("new")) {
      setCreating(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const name = form.name.trim() || "Untitled key";
      const k = await createKey({ name, env: form.env, scopes: form.scopes });
      setSecret({ name, value: k.key });
      setCreating(false);
      setForm({ name: "", env: "live", scopes: ["generate", "read", "usage"] });
      await refresh();
    } catch (e) {
      toast(e.message || "Could not create key");
    }
    setBusy(false);
  };

  const doRevoke = async () => {
    try {
      await deleteKey(revoke.id);
      toast(`Revoked ${revoke.name}`);
      setRevoke(null);
      await refresh();
    } catch (e) {
      toast(e.message || "Could not revoke key");
    }
  };

  const toggleScope = (s) =>
    setForm((f) => ({ ...f, scopes: f.scopes.includes(s) ? f.scopes.filter((x) => x !== s) : [...f.scopes, s] }));

  return (
    <>
      <PageHeader
        eyebrow="Developers"
        title="API"
        accent="keys"
        sub="Secret keys authenticate your server-side requests. Never expose them in browsers or mobile apps."
        actions={
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={13} /> Create key
          </button>
        }
      />

      <section className="card">
        {keys.length === 0 ? (
          <div className="empty">
            <Icon name="key" size={22} />
            <b>No API keys yet</b>
            <span>Create your first key to start making requests.</span>
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={13} /> Create key
            </button>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key</th>
                  <th>Env</th>
                  <th>Scopes</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td className="strong">{k.name}</td>
                    <td className="mono muted">
                      {k.prefix}••••••••{k.last4}
                    </td>
                    <td>
                      <span className={`badge ${k.env === "live" ? "orange" : ""}`}>{k.env}</span>
                    </td>
                    <td className="muted">{k.scopes.join(", ")}</td>
                    <td className="muted">{timeAgo(k.created)}</td>
                    <td className="muted">{k.lastUsed ? timeAgo(k.lastUsed) : "Never"}</td>
                    <td className="right">
                      <button className="btn sm danger" onClick={() => setRevoke(k)}>
                        <Icon name="trash" size={11} /> Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="callout">
        <Icon name="shield" size={14} />
        <span>
          Store keys in environment variables, rotate them regularly, and use separate <b>test</b> keys for development.
        </span>
      </div>

      {creating && (
        <Modal
          title="Create API key"
          onClose={() => setCreating(false)}
          footer={
            <>
              <button className="btn" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button className="btn primary" onClick={create} disabled={!form.scopes.length || busy}>
                {busy ? "Creating…" : "Create key"}
              </button>
            </>
          }
        >
          <label className="field">
            <span>Name</span>
            <input
              className="input"
              autoFocus
              placeholder="e.g. Production server"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
          </label>
          <div className="field">
            <span>Environment</span>
            <div className="seg">
              {["live", "test"].map((e) => (
                <button key={e} className={form.env === e ? "on" : ""} onClick={() => setForm({ ...form, env: e })}>
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>Permissions</span>
            {SCOPES.map(([s, l]) => (
              <label className="check" key={s}>
                <input type="checkbox" checked={form.scopes.includes(s)} onChange={() => toggleScope(s)} />
                <i /> {l} <code className="inline">{s}</code>
              </label>
            ))}
          </div>
        </Modal>
      )}

      {secret && (
        <Modal
          title="Save your secret key"
          onClose={() => setSecret(null)}
          footer={
            <button className="btn primary" onClick={() => setSecret(null)}>
              I have saved it
            </button>
          }
        >
          <div className="notice">This is the only time the full key is shown. Copy it now and store it somewhere safe.</div>
          <div className="secret">
            <code>{secret.value}</code>
            <CopyButton text={secret.value} />
          </div>
        </Modal>
      )}

      {revoke && (
        <Modal
          title="Revoke key?"
          onClose={() => setRevoke(null)}
          footer={
            <>
              <button className="btn" onClick={() => setRevoke(null)}>
                Cancel
              </button>
              <button className="btn danger solid" onClick={doRevoke}>
                Revoke key
              </button>
            </>
          }
        >
          Requests using <b>{revoke.name}</b> will fail immediately. This cannot be undone.
        </Modal>
      )}
    </>
  );
}