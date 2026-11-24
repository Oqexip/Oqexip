// Shared look for every generated card: one atlas, two printings.
// "dark" is the night sky; "light" is the same chart engraved on paper.

export const FONTS = {
  serif: `'Iowan Old Style','Palatino Linotype','Book Antiqua',Palatino,Georgia,'Times New Roman',serif`,
  mono: `ui-monospace,SFMono-Regular,'Cascadia Mono','Segoe UI Mono',Menlo,Consolas,monospace`,
};

export const THEMES = {
  dark: {
    dark: true,
    paper: "#070b16",
    rule: "#1c2742",
    ink: "#e8eaf2",
    muted: "#8c95ab",
    faint: "#46526e",
    accent: "#e9c37a",
    live: "#ff6f61",
    line: "#8fa7e2",
    grid: "#2a3a60",
  },
  light: {
    dark: false,
    paper: "#f4eddd",
    rule: "#26304b",
    ink: "#1f2740",
    muted: "#5e6577",
    faint: "#b3a88f",
    accent: "#a8402a",
    live: "#c0392b",
    line: "#a8402a",
    grid: "#b9ad93",
  },
};

export const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Small seeded PRNG (mulberry32) so a given hour always draws the same picture. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Greedy word wrap by character budget; SVG text has no wrapping of its own. */
export function wrap(text, width) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && (line + " " + word).length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

export const r1 = (v) => Math.round(v * 10) / 10;
export const r2 = (v) => Math.round(v * 100) / 100;

/** Fine paper grain for the engraved printing. */
export const grainFilter = (id, opacity) => `
    <filter id="${id}" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" stitchTiles="stitch"/>
      <feColorMatrix values="0 0 0 0 0.16  0 0 0 0 0.12  0 0 0 0 0.07  ${opacity} 0 0 0 -${(opacity * 0.35).toFixed(3)}"/>
    </filter>`;

/** Shared <style> block: fonts, plus motion that switches off for people who ask for less. */
export const baseStyle = (t, extra = "") => `
    <style>
      .serif{font-family:${FONTS.serif}}
      .mono{font-family:${FONTS.mono}}
      .caps{font-family:${FONTS.mono};letter-spacing:.16em;text-transform:uppercase}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:.2}}
      .pulse{animation:pulse 2.4s ease-in-out infinite}
      ${extra}
      @media (prefers-reduced-motion:reduce){*{animation:none!important}}
    </style>`;

/** The card behind each graphic: a night panel, or a paper plate with a double rule. */
export function frame(t, w, h) {
  if (t.dark) {
    return `
  <rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="14" fill="${t.paper}" stroke="${t.rule}"/>`;
  }
  return `
  <rect width="${w}" height="${h}" rx="3" fill="${t.paper}"/>
  <rect width="${w}" height="${h}" rx="3" filter="url(#grain)"/>
  <rect x="9" y="9" width="${w - 18}" height="${h - 18}" fill="none" stroke="${t.rule}" stroke-width="1.3"/>
  <rect x="13.5" y="13.5" width="${w - 27}" height="${h - 27}" fill="none" stroke="${t.rule}" stroke-width=".5"/>`;
}
