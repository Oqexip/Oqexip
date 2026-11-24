// "A year of light": the contribution calendar drawn as a star field. One star
// per day, brighter for busier days, with the streaks drawn as constellations.

import { THEMES, baseStyle, esc, frame, grainFilter, r1, r2 } from "./atlas.mjs";

const W = 1000;
const H = 352;
const GRID = { x: 66, y: 116, dx: 16.9, dy: 18.5 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86400000;

const utc = (iso) => Date.parse(`${iso}T00:00:00Z`);
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const nice = (iso, year = false) => {
  const d = new Date(utc(iso));
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${year ? `, ${d.getUTCFullYear()}` : ""}`;
};

/** Stable per-day jitter so the grid reads as a sky, not a spreadsheet. */
function jitter(iso) {
  let h = 2166136261;
  for (const c of iso) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const a = ((h >>> 0) % 1000) / 1000;
  const b = (((h >>> 10) >>> 0) % 1000) / 1000;
  return [(a - 0.5) * 4.6, (b - 0.5) * 4.6];
}

/**
 * @param {{calendar: {date: string, count: number}[], total: number, firstDay: string,
 *          current: {length: number, start: string|null, end: string|null},
 *          longest: {length: number, start: string|null, end: string|null}}} stats
 */
export function contributionSky(stats, t) {
  const { calendar, total, firstDay, current, longest } = stats;
  const { dark } = t;
  const byDate = new Map(calendar.map((d) => [d.date, d.count]));
  const last = calendar.at(-1).date;
  // 53 columns ending this week, starting on a Sunday, like GitHub's own calendar.
  const lastMs = utc(last);
  const startMs = lastMs - 364 * DAY - new Date(lastMs - 364 * DAY).getUTCDay() * DAY;
  const days = [];
  for (let ms = startMs; ms <= lastMs; ms += DAY) {
    const iso = isoOf(ms);
    const col = Math.floor((ms - startMs) / (7 * DAY));
    const row = new Date(ms).getUTCDay();
    const [jx, jy] = jitter(iso);
    days.push({ iso, count: byDate.get(iso) ?? 0, x: GRID.x + col * GRID.dx + jx, y: GRID.y + row * GRID.dy + jy, col });
  }
  const at = new Map(days.map((d) => [d.iso, d]));

  // Brightness levels from the quartiles of active days, as GitHub does.
  const active = days.filter((d) => d.count > 0).map((d) => d.count).sort((a, b) => a - b);
  const q = (p) => active[Math.min(active.length - 1, Math.floor(p * active.length))] ?? 1;
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  const level = (c) => (c === 0 ? 0 : c <= q1 ? 1 : c <= q2 ? 2 : c <= q3 ? 3 : 4);
  const RADIUS = [0.95, 1.45, 2.05, 2.75, 3.6];
  const brightest = days.reduce((a, b) => (b.count >= a.count ? b : a), days[0]); // ties go to the most recent day
  const yearTotal = days.reduce((s, d) => s + d.count, 0);

  const starFill = dark ? ["#56658a", "#9fb1dc", "#c7d3f2", "#e9eefc", "#fff7e2"] : [t.faint, t.ink, t.ink, t.ink, t.ink];
  const stars = days.map((d) => {
    const lv = level(d.count);
    const glow = dark && lv >= 3 ? `<circle cx="${r1(d.x)}" cy="${r1(d.y)}" r="${r1(RADIUS[lv] * 2.4)}" fill="${starFill[lv]}" opacity="${lv === 4 ? 0.26 : 0.14}" filter="url(#soft)"/>` : "";
    const tw = dark && lv === 4 ? ` class="tw${d.col % 3}"` : "";
    const opacity = dark ? (lv === 0 ? 0.7 : 1) : lv === 0 ? 0.8 : [0, 0.55, 0.75, 0.9, 1][lv];
    return `<g${tw}>${glow}<circle cx="${r1(d.x)}" cy="${r1(d.y)}" r="${r2(RADIUS[lv])}" fill="${starFill[lv]}" opacity="${opacity}"/></g>`;
  });

  // Streaks become constellation figures, joined day by day.
  const figure = (streak, color, cls) => {
    if (!streak.start || streak.length < 2) return { svg: "", tip: null };
    const pts = [];
    for (let ms = utc(streak.start); ms <= utc(streak.end); ms += DAY) {
      const d = at.get(isoOf(ms));
      if (d) pts.push(d);
    }
    if (pts.length < 2) return { svg: "", tip: null };
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${r1(p.x)} ${r1(p.y)}`).join("");
    return {
      svg: `<path class="${cls}" d="${d}" fill="none" stroke="${color}" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round" opacity="${dark ? 0.8 : 0.85}" style="stroke-dasharray:${r1(len + 1)};--len:${r1(len + 1)}"/>`,
      tip: pts.at(-1),
      head: pts[0],
    };
  };
  const sameStreak = current.start && current.start === longest.start && current.end === longest.end;
  const cur = figure(current, t.accent, "draw");
  const lng = sameStreak ? { svg: "", tip: null } : figure(longest, t.line, "draw slow");

  const notes = [];
  const note = (x, y, text, fill, anchor = "start") =>
    notes.push(`<text x="${r1(x)}" y="${r1(y)}" text-anchor="${anchor}" class="serif" font-size="12" font-style="italic" fill="${fill}">${esc(text)}</text>`);
  // Notes sit in the margin above the grid so they never cover a star.
  const noteY = GRID.y - 30;
  const anchorFor = (x) => (x > W - 190 ? "end" : x < 190 ? "start" : "middle");
  if (cur.tip) {
    note(cur.tip.x, noteY, `${sameStreak ? "current & longest" : "current"} streak · ${current.length} days`, t.accent, anchorFor(cur.tip.x));
    notes.push(`<path d="M${r1(cur.tip.x)} ${noteY + 5}V${r1(cur.tip.y - 6)}" stroke="${t.accent}" stroke-width=".6" stroke-dasharray="1.5 2.5" opacity=".7"/>`);
  }
  if (lng.tip && (!cur.tip || Math.abs(lng.tip.x - cur.tip.x) > 220)) {
    note(lng.tip.x, noteY, `longest streak · ${longest.length} days`, t.line, anchorFor(lng.tip.x));
    notes.push(`<path d="M${r1(lng.tip.x)} ${noteY + 5}V${r1(lng.tip.y - 6)}" stroke="${t.line}" stroke-width=".6" stroke-dasharray="1.5 2.5" opacity=".7"/>`);
  }
  if (brightest.count > 0) {
    const b = brightest;
    notes.push(`<circle cx="${r1(b.x)}" cy="${r1(b.y)}" r="7.5" fill="none" stroke="${t.accent}" stroke-width=".8" opacity=".9"/>`);
    const below = GRID.y + 6 * GRID.dy + 26;
    note(b.x, below, `brightest day · ${nice(b.iso)} · ${b.count}`, t.muted, anchorFor(b.x));
    notes.push(`<path d="M${r1(b.x)} ${r1(b.y + 8)}V${below - 12}" stroke="${t.muted}" stroke-width=".6" stroke-dasharray="1.5 2.5" opacity=".7"/>`);
  }
  const today = at.get(last);
  const todayRing = `<circle class="pulse" cx="${r1(today.x)}" cy="${r1(today.y)}" r="5.5" fill="none" stroke="${t.live}" stroke-width="1"/>`;

  // Month names over the first column that starts in each month.
  const months = days
    .filter((d) => new Date(utc(d.iso)).getUTCDay() === 0 && new Date(utc(d.iso)).getUTCDate() <= 7)
    .map((d) => `<text x="${r1(GRID.x + d.col * GRID.dx - 3)}" y="${GRID.y - 16}" class="caps" font-size="8.5" fill="${t.muted}">${MONTHS[new Date(utc(d.iso)).getUTCMonth()]}</text>`);

  const thisYear = last.slice(0, 4);
  const range = (s) => {
    if (!s.start) return "";
    const year = s.end.slice(0, 4) === thisYear ? "" : `, ${s.end.slice(0, 4)}`;
    if (s.start === s.end) return ` · ${nice(s.start)}${year}`;
    const [a, b] = [new Date(utc(s.start)), new Date(utc(s.end))];
    const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
    return ` · ${nice(s.start)}${a.getUTCFullYear() !== b.getUTCFullYear() ? `, ${s.start.slice(0, 4)}` : ""} – ${sameMonth ? b.getUTCDate() : nice(s.end)}${year}`;
  };
  const stat = (x, big, unit, caption) => `
    <text x="${x}" y="${H - 46}" class="serif" font-size="30" fill="${t.ink}">${esc(big)}<tspan font-size="15" fill="${t.muted}" dx="7">${esc(unit)}</tspan></text>
    <text x="${x}" y="${H - 27}" class="caps" font-size="8" fill="${t.muted}">${esc(caption)}</text>`;
  const days_ = (n) => (n === 1 ? "day" : "days");
  const statsRow = [
    stat(66, total.toLocaleString("en-US"), "contributions", `all time · since ${MONTHS[new Date(utc(firstDay)).getUTCMonth()]} ${firstDay.slice(0, 4)}`),
    stat(290, yearTotal.toLocaleString("en-US"), "in 12 months", "every star above"),
    stat(500, String(current.length), days_(current.length), current.start ? `current streak · since ${nice(current.start)}` : "current streak"),
    stat(712, String(longest.length), days_(longest.length), `longest streak${range(longest)}`),
  ].join("");

  const css = [
    "@keyframes tw{0%,100%{opacity:1}50%{opacity:.55}}",
    ".tw0{animation:tw 3.3s ease-in-out infinite}.tw1{animation:tw 4.1s ease-in-out infinite}.tw2{animation:tw 5.2s ease-in-out infinite}",
    "@keyframes draw{from{stroke-dashoffset:var(--len)}to{stroke-dashoffset:0}}",
    ".draw{animation:draw 2.8s cubic-bezier(.3,.6,.2,1) .4s both}.slow{animation-duration:4s}",
  ].join("\n      ");

  const label = `${total} contributions since ${nice(firstDay, true)}; ${yearTotal} in the last year; current streak ${current.length} days, longest ${longest.length} days.`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title">
  <title id="title">${esc(label)}</title>
  <defs>
    <filter id="soft" x="-2" y="-2" width="5" height="5"><feGaussianBlur stdDeviation="2.2"/></filter>
    ${dark ? "" : grainFilter("grain", 0.55)}
    ${baseStyle(t, css)}
  </defs>
  ${frame(t, W, H)}
  <circle class="pulse" cx="70" cy="46" r="3.4" fill="${t.live}"/>
  <text x="82" y="50" class="caps" font-size="11" fill="${t.accent}">Observation log · a year of light</text>
  <text x="${W - 66}" y="50" text-anchor="end" class="caps" font-size="8.5" fill="${t.muted}">one star per day · brighter = more contributions</text>
  ${months.join("\n  ")}
  ${lng.svg}
  ${cur.svg}
  ${stars.join("")}
  ${todayRing}
  ${notes.join("\n  ")}
  <path d="M66 ${H - 86}H${W - 66}" stroke="${t.rule}" stroke-width="${dark ? 1 : 0.8}" opacity="${dark ? 1 : 0.8}"/>
  ${statsRow}
</svg>
`;
}

export { THEMES };
