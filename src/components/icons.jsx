// SF-Symbols-inspired line icons, 24×24, stroke = currentColor.
const base = {
  width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round'
};

const wrap = (children, size) => (
  <svg {...base} width={size || 20} height={size || 20}>{children}</svg>
);

export const Icons = {
  video: (s) => wrap(<><rect x="2.5" y="5" width="14" height="14" rx="2.5" /><path d="M16.5 10l5-3v10l-5-3z" /></>, s),
  audio: (s) => wrap(<><path d="M3 12h2l2-6 3 12 3-9 2 3h6" /></>, s),
  subtitle: (s) => wrap(<><rect x="2.5" y="4.5" width="19" height="15" rx="2.5" /><path d="M6 15h6M14 15h4" /></>, s),
  queue: (s) => wrap(<><path d="M4 6h16M4 12h16M4 18h10" /></>, s),
  settings: (s) => wrap(<><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" /></>, s),

  convert: (s) => wrap(<><path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" /></>, s),
  compress: (s) => wrap(<><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M12 8v8M8.8 12.8L12 16l3.2-3.2" /></>, s),
  merge: (s) => wrap(<><rect x="3" y="4" width="8" height="7" rx="2" /><rect x="13" y="4" width="8" height="7" rx="2" /><rect x="8" y="14" width="8" height="6" rx="2" /></>, s),
  trim: (s) => wrap(<><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="6.5" cy="17.5" r="2.5" /><path d="M8.5 8.2L20 19M8.5 15.8L20 5" /></>, s),
  crop: (s) => wrap(<><path d="M6.5 2.5v13.5H20M2.5 6.5H16V20" /></>, s),
  scale: (s) => wrap(<><path d="M9 4H4v5M15 20h5v-5M4 4l6 6M20 20l-6-6" /></>, s),
  rotate: (s) => wrap(<><path d="M20 5v6h-6" /><path d="M20 11a8 8 0 1 0-2.3 5.7" /></>, s),
  speed: (s) => wrap(<><path d="M4 16a8 8 0 1 1 16 0" /><path d="M12 16l4-5" /></>, s),
  mute: (s) => wrap(<><path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></>, s),
  replaceAudio: (s) => wrap(<><path d="M7 17V7l9-2.5V14" /><circle cx="4.5" cy="17" r="2.2" /><circle cx="13.5" cy="16" r="2.2" /><path d="M17.5 9.5l3 3M20.5 9.5l-3 3" /></>, s),
  extractAudio: (s) => wrap(<><path d="M3 12h1.5l1.5-4 2 8 2-6 1.5 2H15" /><path d="M17 9v6M20 9v6" transform="translate(0,0)" /></>, s),
  frames: (s) => wrap(<><rect x="3" y="5" width="12" height="10" rx="2" /><path d="M6 18h12a3 3 0 0 0 3-3V8" /><circle cx="7.5" cy="8.5" r="1.3" /><path d="M4 13l3-2.5 2.5 2 2-1.5 3.5 3" /></>, s),
  anim: (s) => wrap(<><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3 9h18M7 7.2h.01M9.5 7.2h.01" /><path d="M10 13.5l4 2-4 2z" /></>, s),
  embedSubs: (s) => wrap(<><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M6 15.5h5M13.5 15.5h4.5" /><path d="M6 10.5h12" opacity="0.4" /></>, s),
  burnSubs: (s) => wrap(<><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M6 15.5h5M13.5 15.5h4.5" /><path d="M12 2.2l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z" /></>, s),
  remux: (s) => wrap(<><path d="M4 7.5h9l-3-3M4 16.5h9l-3 3" /><rect x="14.5" y="9" width="6" height="6" rx="1.5" /></>, s),
  metadata: (s) => wrap(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6h.01" /></>, s),
  volume: (s) => wrap(<><path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z" /><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" /></>, s),
  loudnorm: (s) => wrap(<><path d="M4 17a8.5 8.5 0 1 1 16 0" /><path d="M12 17l3.5-6" /><circle cx="12" cy="17" r="1.2" /></>, s),
  shift: (s) => wrap(<><circle cx="11" cy="12" r="8" /><path d="M11 8v4l3 2" /><path d="M19.5 3.5l1.5 4-4-1z" transform="rotate(45 20 5.5)" opacity="0" /><path d="M21 4l-4 4" /></>, s),
  reencode: (s) => wrap(<><path d="M4 7V5h16v2M12 5v14M9 19h6" /><path d="M17 12l3 3-3 3" transform="translate(-1,0)" opacity="0" /><path d="M19 9v6" /></>, s),
  extractSubs: (s) => wrap(<><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M6 15.5h5M13.5 15.5h4.5" /><path d="M12 2v3" opacity="0.5" /><path d="M9 2h6" opacity="0.5" /></>, s),

  plus: (s) => wrap(<><path d="M12 5v14M5 12h14" /></>, s),
  x: (s) => wrap(<><path d="M6 6l12 12M18 6L6 18" /></>, s),
  up: (s) => wrap(<><path d="M12 19V5M6 11l6-6 6 6" /></>, s),
  down: (s) => wrap(<><path d="M12 5v14M6 13l6 6 6-6" /></>, s),
  folder: (s) => wrap(<><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>, s),
  play: (s) => wrap(<><path d="M8 5.5v13l11-6.5z" /></>, s),
  pause: (s) => wrap(<><path d="M8.5 5.5v13M15.5 5.5v13" /></>, s),
  stop: (s) => wrap(<><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" /></>, s),
  trash: (s) => wrap(<><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" /><path d="M10 10.5v6M14 10.5v6" /></>, s),
  check: (s) => wrap(<><path d="M5 12.5l4.5 4.5L19 7" /></>, s),
  clock: (s) => wrap(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>, s),
  doc: (s) => wrap(<><path d="M6 2.5h8l4 4V21.5H6z" /><path d="M14 2.5v4h4" /></>, s),
  bolt: (s) => wrap(<><path d="M13 2.5L5 13.5h5l-1 8 8-11h-5z" /></>, s)
};

export function Icon({ name, size }) {
  const C = Icons[name] || Icons.doc;
  return C(size);
}
