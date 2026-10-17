export default function PageHeader({ eyebrow, title, accent, sub, children }) {
  return (
    <div className="page-h">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title} {accent && <em>{accent}</em>}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}
