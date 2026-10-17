import PageHeader from "../components/PageHeader.jsx";
import { Link } from "react-router-dom";

const INVOICES = [
  { id: "INV-0007", date: "Oct 1, 2026", amt: "$0.00", st: "paid" },
  { id: "INV-0006", date: "Sep 1, 2026", amt: "$0.00", st: "paid" },
  { id: "INV-0005", date: "Aug 1, 2026", amt: "$0.00", st: "paid" },
];

export default function Billing() {
  return (
    <>
      <PageHeader eyebrow="Account" title="Bill" accent="ing" sub="Manage your plan, payment method, and invoices.">
        <Link to="/pricing" className="btn primary">Upgrade plan</Link>
      </PageHeader>
      <div className="grid g3">
        <div className="stat"><div className="stat-l">Current plan</div><div className="stat-v">Free</div><div className="stat-s">$0 / month</div></div>
        <div className="stat"><div className="stat-l">Credits used</div><div className="stat-v">38<small>/ 100</small></div><div className="bar"><i style={{ width: "38%" }} /></div></div>
        <div className="stat"><div className="stat-l">Resets in</div><div className="stat-v">15<small>days</small></div><div className="stat-s">Nov 1, 2026</div></div>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-h"><h2>Payment method</h2></div>
          <div className="empty small"><b>No card on file</b>Add a card to upgrade or enable pay-as-you-go.<button className="btn">Add card</button></div>
        </div>
        <div className="card">
          <div className="card-h"><h2>Spend controls</h2></div>
          <div className="card-b">
            <label className="switch"><input type="checkbox" defaultChecked /><i />Email me at 80% of monthly credits</label>
            <label className="switch"><input type="checkbox" /><i />Auto-recharge when credits run out</label>
            <label className="field"><span>Monthly spend cap</span><input className="input" placeholder="$ 0.00" /></label>
          </div>
        </div>
      </div>

      <div className="section-l">Invoices</div>
      <div className="card"><div className="card-b flush"><div className="table-wrap flat">
        <table className="table"><thead><tr><th>Invoice</th><th>Date</th><th>Amount</th><th>Status</th><th></th></tr></thead>
          <tbody>{INVOICES.map(i => (<tr key={i.id}><td className="mono">{i.id}</td><td>{i.date}</td><td className="mono">{i.amt}</td>
            <td><span className="badge green">{i.st}</span></td><td className="right"><button className="btn sm">Download</button></td></tr>))}</tbody></table>
      </div></div></div>
    </>
  );
}
