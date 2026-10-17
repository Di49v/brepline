import { useMemo, useState } from "react";
import { highlight } from "../lib/highlight.js";
import { useToast } from "./Toast.jsx";
import Icon from "./Icon.jsx";

export function CopyButton({ text, label = "Copy", className = "" }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard blocked */
    }
    setDone(true);
    toast("Copied to clipboard");
    setTimeout(() => setDone(false), 1400);
  };
  return (
    <button className={`btn sm ${className}`} onClick={copy}>
      <Icon name={done ? "check" : "copy"} size={11} /> {done ? "Copied" : label}
    </button>
  );
}

/** Single block: <Code code lang /> or tabbed: <Code tabs={{ Label: {lang, code} }} /> */
export default function Code({ code, lang = "json", tabs, title }) {
  const labels = tabs ? Object.keys(tabs) : [];
  const [tab, setTab] = useState(labels[0]);
  const active = tabs ? tabs[tab] || tabs[labels[0]] : { code, lang };
  const html = useMemo(() => highlight(active.code, active.lang), [active.code, active.lang]);

  return (
    <div className="code">
      <div className="code-bar">
        {tabs ? (
          <div className="tabs">
            {labels.map((l) => (
              <button key={l} className={`tab ${l === tab ? "on" : ""}`} onClick={() => setTab(l)}>
                {l}
              </button>
            ))}
          </div>
        ) : (
          <span className="code-title">{title || active.lang}</span>
        )}
        <CopyButton text={active.code} />
      </div>
      <pre dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
