const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const KEYWORDS = {
  python: "import|from|as|def|return|print|if|else|for|in|with|True|False|None|class|try|except",
  javascript: "const|let|var|await|async|function|return|new|if|else|for|of|import|from|export|true|false|null|undefined",
  json: "true|false|null",
  bash: "curl|echo|export|npm|pip|install",
};

export function highlight(code, lang = "json") {
  const l = lang === "js" || lang === "node" ? "javascript" : lang;
  const comment = l === "python" || l === "bash" ? "#[^\\n]*" : "\\/\\/[^\\n]*";
  const str = "\"(?:[^\"\\\\\\n]|\\\\.)*\"|'(?:[^'\\\\\\n]|\\\\.)*'|`(?:[^`\\\\]|\\\\.)*`";
  const kw = `\\b(?:${KEYWORDS[l] || KEYWORDS.json})\\b`;
  const num = "\\b\\d+(?:\\.\\d+)?\\b";
  const flag = l === "bash" ? "(?<=\\s)--?[A-Za-z][\\w-]*" : "(?!)";
  const re = new RegExp(`(${comment})|(${str})|(${kw})|(${num})|(${flag})`, "g");

  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    const [txt, c, s, k, n, f] = m;
    let cls = "t-n";
    if (c) cls = "t-c";
    else if (s) cls = code[m.index + txt.length] === ":" ? "t-key" : "t-s";
    else if (k) cls = "t-k";
    else if (n) cls = "t-n";
    else if (f) cls = "t-f";
    out += `<span class="${cls}">${esc(txt)}</span>`;
    last = m.index + txt.length;
  }
  return out + esc(code.slice(last));
}
