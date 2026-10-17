const P = {
  logo: "M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM4 7.5L12 12l8-4.5M12 12v9",
  home: "M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1v-9z",
  key: "M15 7a4 4 0 11-3.9 4.9L4 19v-3h3v-2h2l2.1-2.1A4 4 0 0115 7zm1 2h.01",
  play: "M7 5l12 7-12 7V5z",
  book: "M5 4h10a3 3 0 013 3v13H8a3 3 0 01-3-3V4zm0 13a3 3 0 013-3h10",
  chart: "M4 20V10m6 10V4m6 16v-7m4 7H3",
  hook: "M9 8a3 3 0 106 0 3 3 0 00-6 0zm-4 9a3 3 0 106 0 3 3 0 00-6 0zm8 0a3 3 0 106 0 3 3 0 00-6 0zm-3-4.5l1.5-2m3 0L16 13",
  tag: "M3 12V4h8l9 9-8 8-9-9zm5-5h.01",
  chat: "M4 5h16v11H9l-5 4V5z",
  copy: "M8 8h11v12H8V8zm-3 8V4h11",
  check: "M5 12.5l4.5 4.5L19 7.5",
  plus: "M12 5v14M5 12h14",
  trash: "M5 7h14M10 4h4M7 7l1 13h8l1-13M10 11v6M14 11v6",
  x: "M6 6l12 12M18 6L6 18",
  ext: "M14 4h6v6M20 4l-9 9M18 14v5H5V6h5",
  menu: "M4 7h16M4 12h16M4 17h16",
  chev: "M8 10l4 4 4-4",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zm7-3l2-1-2-4-2 1a7 7 0 00-2-1l-.5-2h-4l-.5 2a7 7 0 00-2 1l-2-1-2 4 2 1a7 7 0 000 2l-2 1 2 4 2-1a7 7 0 002 1l.5 2h4l.5-2a7 7 0 002-1l2 1 2-4-2-1a7 7 0 000-2z",
  bolt: "M13 3L5 13h6l-1 8 8-10h-6l1-8z",
  download: "M12 4v11m-5-5l5 5 5-5M5 20h14",
  arrow: "M5 12h14m-6-6l6 6-6 6",
  shield: "M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z",
  cube: "M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z",
  sun: "M12 8a4 4 0 100 8 4 4 0 000-8zm0-5v2m0 14v2M3 12h2m14 0h2M5.6 5.6L7 7m10 10l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4",
  moon: "M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z",
};

export default function Icon({ name, size = 15, stroke = 1.6, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={P[name] || ""} />
    </svg>
  );
}
