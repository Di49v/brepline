import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";
import { PLAN } from "../lib/config.js";
import { useTheme } from "../lib/theme.js";

const NAV = [
  { to: "/", label: "Overview", icon: "home", end: true },
  { to: "/keys", label: "API keys", icon: "key" },
  { to: "/playground", label: "Playground", icon: "play" },
  { to: "/generations", label: "Generations", icon: "logo" },
  { to: "/models", label: "Models", icon: "chart" },
  { to: "/docs", label: "Documentation", icon: "book" },
];
// Icon names below reuse ones that already exist in Icon.jsx; swap in new ones once you add them.
const NAV_RESOURCES = [
  { to: "/changelog", label: "Changelog", icon: "tag" },
  { to: "/status", label: "Status", icon: "hook" },
];
const NAV2 = [
  { to: "/usage", label: "Usage", icon: "chart" },
  { to: "/webhooks", label: "Webhooks", icon: "hook" },
  { to: "/team", label: "Team", icon: "chat" },
  { to: "/billing", label: "Billing", icon: "tag" },
  { to: "/settings", label: "Settings", icon: "key" },
  { to: "/pricing", label: "Pricing", icon: "tag" },
];

const TITLES = {
  "/": "Overview",
  "/keys": "API keys",
  "/playground": "Playground",
  "/generations": "Generations",
  "/models": "Models",
  "/docs": "Documentation",
  "/changelog": "Changelog",
  "/status": "Status",
  "/usage": "Usage",
  "/webhooks": "Webhooks",
  "/team": "Team",
  "/billing": "Billing",
  "/settings": "Settings",
  "/pricing": "Pricing",
};

function Item({ to, label, icon, end }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? "on" : ""}`}>
      <Icon name={icon} size={15} /> {label}
    </NavLink>
  );
}

export default function Layout() {
  const [open, setOpen] = useState(false);
  const [banner, setBanner] = useState(true);
  const { pathname } = useLocation();
  const nav = useNavigate();
  const [theme, toggleTheme] = useTheme();

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  return (
    <div className="app">
      <aside className={`side ${open ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">
            <Icon name="logo" size={17} stroke={1.8} />
          </span>
          BREPLINE
        </div>

        <button className="btn primary block" onClick={() => nav("/keys?new=1")}>
          <Icon name="plus" size={14} /> New API key
        </button>

        <nav className="nav">
          <div className="nav-label">Developers</div>
          {NAV.map((n) => (
            <Item key={n.to} {...n} />
          ))}
          <div className="nav-label">Resources</div>
          {NAV_RESOURCES.map((n) => (
            <Item key={n.to} {...n} />
          ))}
          <div className="nav-label">Account</div>
          {NAV2.map((n) => (
            <Item key={n.to} {...n} />
          ))}
        </nav>

        <div className="side-foot">
          <a className="nav-item" href="/">
            <Icon name="chat" size={15} /> Back to chat
          </a>
          <div className="user">
            <span className="avatar">T</span>
            <div>
              <div className="user-n">Tegkirat</div>
              <div className="user-p">{PLAN.name} plan</div>
            </div>
          </div>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div className="main">
        <div className="top">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Menu">
            <Icon name="menu" size={15} />
          </button>
          <div className="crumb">
            <span>API</span>
            <span className="sep">/</span>
            <b>{TITLES[pathname] || "Overview"}</b>
          </div>
          <span className="grow" />
          {banner && (
            <div className="plan-pill">
              {PLAN.name} plan <span className="dot-sep">·</span>
              <button className="link" onClick={() => nav("/pricing")}>
                Upgrade
              </button>
              <button className="icon-btn tiny" onClick={() => setBanner(false)} aria-label="Dismiss">
                <Icon name="x" size={10} />
              </button>
            </div>
          )}
          <span className="grow" />
          <button className="btn sm theme-btn" onClick={toggleTheme} aria-label="Toggle light or dark theme">
            <Icon name={theme === "dark" ? "sun" : "moon"} size={12} />
            <span>{theme === "dark" ? "Light" : "Dark"}</span>
          </button>
          <div className="engine">
            <i className="dot" /> Engine online
          </div>
        </div>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}