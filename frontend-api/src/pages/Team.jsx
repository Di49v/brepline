import { useState } from "react";
import PageHeader from "../components/PageHeader.jsx";

const INIT = [
  { name: "Tegkirat", email: "you@brepline.com", role: "Owner", status: "active" },
  { name: "Aarav Singh", email: "aarav@brepline.com", role: "Admin", status: "active" },
  { name: "Mia Chen", email: "mia@brepline.com", role: "Developer", status: "active" },
  { name: "Noah Patel", email: "noah@brepline.com", role: "Viewer", status: "invited" },
];

export default function Team() {
  const [members, setMembers] = useState(INIT);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Developer");
  const invite = () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) return;
    setMembers(m => [...m, { name: email.split("@")[0], email, role, status: "invited" }]);
    setEmail("");
  };
  return (
    <>
      <PageHeader eyebrow="Account" title="Te" accent="am" sub="Invite teammates and control who can create keys, view usage, or manage billing." />
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h"><h2>Invite a teammate</h2></div>
        <div className="card-b">
          <div className="row">
            <label className="field" style={{ flex: 1, minWidth: 220 }}><span>Email</span>
              <input className="input" placeholder="name@company.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && invite()} /></label>
            <label className="field" style={{ width: 160 }}><span>Role</span>
              <select className="input" value={role} onChange={e => setRole(e.target.value)}><option>Admin</option><option>Developer</option><option>Viewer</option></select></label>
            <button className="btn primary" style={{ alignSelf: "flex-end" }} onClick={invite}>Send invite</button>
          </div>
          <div className="hint">Free plan includes up to 5 seats. {members.length}/5 used.</div>
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h2>Members</h2><span className="badge">{members.length}</span></div>
        <div className="card-b flush"><div className="table-wrap flat">
          <table className="table">
            <thead><tr><th>Member</th><th>Role</th><th>Status</th><th className="right"></th></tr></thead>
            <tbody>{members.map(m => (
              <tr key={m.email}>
                <td><div className="row" style={{ flexWrap: "nowrap" }}>
                  <div className="avatar">{m.name[0].toUpperCase()}</div>
                  <div><div className="strong">{m.name}</div><div className="muted">{m.email}</div></div></div></td>
                <td><span className={"badge " + (m.role === "Owner" ? "orange" : "")}>{m.role}</span></td>
                <td><span className={"badge " + (m.status === "active" ? "green" : "")}>{m.status}</span></td>
                <td className="right">{m.role !== "Owner" && <button className="btn sm danger" onClick={() => setMembers(x => x.filter(y => y.email !== m.email))}>Remove</button>}</td>
              </tr>))}
            </tbody>
          </table>
        </div></div>
      </div>

      <div className="section-l">Role permissions</div>
      <div className="grid g4">
        {[["Owner", "Everything, including deleting the workspace"], ["Admin", "Keys, webhooks, team, billing"], ["Developer", "Keys, playground, usage"], ["Viewer", "Read-only access to usage and docs"]].map(([r, d]) => (
          <div key={r} className="faq"><h3>{r}</h3><p>{d}</p></div>))}
      </div>
    </>
  );
}
