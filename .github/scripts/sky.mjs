// Draws the real sky over Indonesia for the moment it runs: 1,627 catalogued
// stars, the IAU constellation figures, the Milky Way, the Sun, the Moon with
// its true phase and tilt, and the five naked-eye planets. The workflow runs
// it every hour, so the README header is never the same picture twice.
//
// Usage: node sky.mjs [out-dir]          (writes sky.svg and sky-dark.svg)
//        SKY_TIME=2026-12-24T13:00Z node sky.mjs dist   (render another instant)

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "./lib/astro.mjs";
import { THEMES, baseStyle, esc, frame, grainFilter, r1, r2, rng, wrap } from "./lib/atlas.mjs";

// Where the sky is seen from: Jakarta, on WIB. Change these to draw the sky over somewhere else.
const PLACE = { name: "Indonesia", lat: -6.2, lon: 106.8, utcOffset: 7, zone: "WIB" };
const PERSON = { name: "Ilham Sikumbang", tagline: "I build for browsers and breadboards." };
const W = 1000;
const H = 520;
const DOME = { cx: 742, cy: 262, R: 212 };
const RAD = Math.PI / 180;

const [outDir = "dist"] = process.argv.slice(2);
const now = process.env.SKY_TIME ? new Date(process.env.SKY_TIME) : new Date();
if (Number.isNaN(now.getTime())) throw new Error(`SKY_TIME is not a date: ${process.env.SKY_TIME}`);
const data = JSON.parse(await readFile(fileURLToPath(new URL("../data/sky.json", import.meta.url)), "utf8"));

// ---------------------------------------------------------------- the scene

const jd = A.julianDay(now);
const lst = A.norm360(A.gmst(jd) + PLACE.lon);
const toHorizon = A.horizon(lst, PLACE.lat);
const precess = A.precessor(jd);
const fromJ2000 = (ra, dec) => toHorizon(...precess(ra, dec));

const sunEq = A.sun(jd);
const sun = toHorizon(sunEq.ra, sunEq.dec);
const moonEq = A.moon(jd);
const moon = toHorizon(moonEq.ra, moonEq.dec);
moon.alt -= moonEq.parallax * Math.cos(moon.alt * RAD); // seen from the surface, not Earth's centre
const phase = A.moonPhase(jd);
const planets = A.planets(jd).map((p) => ({ ...p, ...fromJ2000(p.ra, p.dec) }));
const stars = data.stars
  .map(([ra, dec, mag, bv, name]) => ({ ...fromJ2000(ra, dec), mag, bv, name }))
  .filter((s) => s.alt > -3);
const constellations = Object.keys(data.labels).length;

const sunHourAngle = ((((lst - sunEq.ra) % 360) + 540) % 360) - 180;
const evening = sunHourAngle > 0;
const h = sun.alt;
const daylight =
  h > 6 ? "daytime"
  : h > -0.83 ? "golden hour"
  : h > -6 ? `${evening ? "evening" : "morning"} civil twilight`
  : h > -12 ? `${evening ? "evening" : "morning"} nautical twilight`
  : h > -18 ? `${evening ? "evening" : "morning"} astronomical twilight`
  : "night";

const clamp01 = (t) => Math.max(0, Math.min(1, t));
const lerp = (a, b, t) => a + (b - a) * clamp01(t);
// How much of the starlight survives the sky's own glow.
const starlight = h >= 0 ? 0.24 : h >= -6 ? lerp(0.24, 0.6, -h / 6) : h >= -12 ? lerp(0.6, 0.9, (-h - 6) / 6) : h >= -18 ? lerp(0.9, 1, (-h - 12) / 6) : 1;
const isNight = h < -12;
// The Milky Way needs a properly dark sky, and a bright Moon washes it out.
const moonWash = moon.alt > 0 ? 0.55 * phase.fraction * clamp01(moon.alt / 20) : 0;
const milkyWayDark = clamp01((-h - 6) / 10) * (1 - moonWash);

// ---------------------------------------------------------------- projection

// Stereographic, zenith at the centre, north up and east on the left: the
// sky as you see it lying on your back with your head to the north.
function project({ alt, az }) {
  const r = DOME.R * Math.tan(((90 - alt) / 2) * RAD);
  return [DOME.cx - r * Math.sin(az * RAD), DOME.cy - r * Math.cos(az * RAD)];
}
const vec = ({ alt, az }) => [Math.cos(alt * RAD) * Math.sin(az * RAD), Math.cos(alt * RAD) * Math.cos(az * RAD), Math.sin(alt * RAD)];
const unvec = ([x, y, z]) => ({ alt: Math.asin(Math.max(-1, Math.min(1, z))) / RAD, az: A.norm360(Math.atan2(x, y) / RAD) });

/** Points along the great circle from a to b, every `step` degrees (a itself excluded). */
function arc(a, b, step = 2.5) {
  const [va, vb] = [vec(a), vec(b)];
  const omega = Math.acos(Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
  if (omega < 1e-6) return [b];
  const n = Math.max(1, Math.ceil(omega / RAD / step));
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n;
    const [s1, s2] = [Math.sin((1 - t) * omega) / Math.sin(omega), Math.sin(t * omega) / Math.sin(omega)];
    return unvec(va.map((v, k) => s1 * v + s2 * vb[k]));
  });
}
/** A point `deg` degrees from a towards b. */
function toward(a, b, deg) {
  const [va, vb] = [vec(a), vec(b)];
  const omega = Math.acos(Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
  if (omega < 1e-6 || Math.PI - omega < 1e-6) return { alt: a.alt + deg, az: a.az }; // no defined direction (an eclipse)
  const t = Math.min(1, (deg * RAD) / omega);
  const [s1, s2] = [Math.sin((1 - t) * omega) / Math.sin(omega), Math.sin(t * omega) / Math.sin(omega)];
  return unvec(va.map((v, k) => s1 * v + s2 * vb[k]));
}

/** SVG path through horizontal points, curved like the sky, lifting the pen well below the horizon. */
function skyPath(points, floor = -12) {
  let d = "";
  let pen = false;
  let prev = null;
  for (const p of points) {
    for (const q of prev ? arc(prev, p) : [p]) {
      if (q.alt < floor) {
        pen = false;
        continue;
      }
      const [x, y] = project(q);
      d += `${pen ? "L" : "M"}${r1(x)} ${r1(y)}`;
      pen = true;
    }
    prev = p;
  }
  return d;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const COMPASS_WORDS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const wind = (az) => Math.round(A.norm360(az) / 45) % 8;
const where = ({ alt, az }) => (alt > 78 ? "almost straight overhead" : `${Math.round(alt)}° up in the ${COMPASS_WORDS[wind(az)]}`);

// ---------------------------------------------------------------- colour

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a, b, t) => toHex(hex(a).map((v, i) => lerp(v, hex(b)[i], t)));

// Sky colour at the zenith and at the horizon, by the Sun's altitude.
const SKY = [
  [-90, "#04070f", "#0c1630"],
  [-18, "#04070f", "#0c1630"],
  [-12, "#07102a", "#18264c"],
  [-6, "#11234a", "#46457a"],
  [-2, "#1d3768", "#a8707e"],
  [0, "#284a84", "#de9670"],
  [6, "#3261a6", "#a8c2de"],
  [90, "#3a6eb7", "#a9caea"],
];
function skyAt(alt) {
  for (let i = 1; i < SKY.length; i++) {
    if (alt <= SKY[i][0]) {
      const [a0, z0, h0] = SKY[i - 1];
      const [a1, z1, h1] = SKY[i];
      const t = (alt - a0) / (a1 - a0);
      return [mix(z0, z1, t), mix(h0, h1, t)];
    }
  }
  return SKY.at(-1).slice(1);
}

/** Star colour from B-V: Ballesteros' temperature, then a blackbody fit, softened towards white. */
function starColor(bv) {
  const b = Math.max(-0.4, Math.min(2, bv));
  const t = (4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62))) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const bl = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return mix(toHex([r, g, bl]), "#ffffff", 0.42);
}
const starRadius = (mag) => Math.min(4.1, 0.6 + 0.47 * Math.max(0, 5.3 - mag) ** 1.12);

const PLANET_COLOR = { Mercury: "#d9d0bf", Venus: "#fff4d8", Mars: "#ff9068", Jupiter: "#f7e0b4", Saturn: "#ead39b" };

// ---------------------------------------------------------------- words

// Names this sky has carried in Nusantara long before the IAU drew its lines.
const ASTERISMS = [
  { label: "Gubuk Penceng", ra: 187.0, dec: -59.7 },
  { label: "Waluku", ra: 84.0, dec: -3.2 },
  { label: "Bintang Tujuh", ra: 56.75, dec: 24.12 },
  { label: "Biduk", ra: 183.0, dec: 56.0 },
  { label: "Kalajengking", ra: 254.0, dec: -33.0 },
].map((a) => ({ ...a, ...fromJ2000(a.ra, a.dec) }));
const asterism = (label) => ASTERISMS.find((a) => a.label === label);

const galacticCentre = fromJ2000(...A.galacticToEquatorial(0, 0));
const named = (n) => stars.find((s) => s.name === n);
const planet = (n) => planets.find((p) => p.name === n);
const lightMinutes = (p) => Math.round(p.delta * 8.317);

// Things worth looking up at, each with the darkness and altitude it needs.
const SIGHTS = [
  { at: asterism("Gubuk Penceng"), sun: -8, alt: 10, say: (w) => `Gubuk Penceng, the Southern Cross, is ${w}. Follow its long arm and you are facing south.` },
  { at: asterism("Waluku"), sun: -8, alt: 12, say: (w) => `Lintang Waluku, Orion's Belt, is ${w}. Javanese farmers once timed the planting by it.` },
  { at: asterism("Bintang Tujuh"), sun: -15, alt: 15, say: (w) => `Bintang Tujuh, the Pleiades, is ${w}. Count them: most eyes find six, not seven.` },
  { at: asterism("Biduk"), sun: -12, alt: 8, say: (w) => `Bintang Biduk, the Big Dipper, is ${w}, skimming the northern sky.` },
  { at: asterism("Kalajengking"), sun: -12, alt: 15, say: (w) => `Scorpius is ${w}. Its red heart, Antares, is some 700 times wider than the Sun.` },
  { at: galacticCentre, sun: -15, alt: 15, say: (w) => `The heart of Bima Sakti, the Milky Way, is ${w}, about 26,000 light-years away.` },
  { at: named("Sirius"), sun: -6, alt: 12, say: (w) => `Sirius, the brightest star of the night, is ${w}. Its light left 8.6 years ago.` },
  { at: named("Canopus"), sun: -6, alt: 12, say: (w) => `Canopus, the second-brightest star, is ${w}. Most of Europe never sees it rise.` },
  { at: named("Rigil Kentaurus"), sun: -6, alt: 12, say: (w) => `Alpha Centauri, the nearest star system to us, is ${w}. Its light is 4.4 years old.` },
  { at: planet("Venus"), sun: -2, alt: 4, say: (w) => `Venus is the dazzling light ${w}. Nothing but the Sun and Moon outshines it.` },
  { at: planet("Jupiter"), sun: -5, alt: 10, say: (w) => `Jupiter is the bright, steady light ${w}. Binoculars show four of its moons.` },
  { at: planet("Saturn"), sun: -6, alt: 10, say: (w, p) => `Saturn is ${w}. The light you would see left it ${lightMinutes(p)} minutes ago.` },
  { at: planet("Mars"), sun: -6, alt: 10, say: (w) => `Mars is the orange point ${w}.` },
  { at: planet("Mercury"), sun: -4, alt: 5, say: (w) => `Mercury, the planet few people ever catch, is ${w} in the twilight.` },
  { at: phase.fraction > 0.04 ? moon : null, sun: 10, alt: 4, say: (w) => moonLine(w) },
].filter((s) => s.at && h < s.sun && s.at.alt > s.alt);

function moonLine(w) {
  const pct = Math.round(phase.fraction * 100);
  if (phase.fraction > 0.97) return `The full Moon is ${w}. Its light reaches you ${(moonEq.dist / 299792.458).toFixed(2)} seconds after leaving it.`;
  if (phase.fraction < 0.3 && h < -4) return `A thin ${pct}% Moon is ${w}. The faint glow on its dark side is sunlight bounced off Earth.`;
  return `The ${phase.name.toLowerCase()} Moon is ${w}, ${Math.round(moonEq.dist).toLocaleString("en-US")} km away right now.`;
}

// In daylight, say what the glare is hiding.
if (h > -2) {
  const hidden = [...planets.filter((p) => p.alt > 5 && p.mag < 1.5), ...stars.filter((s) => s.name && s.alt > 5)]
    .sort((a, b) => a.mag - b.mag)
    .slice(0, 3)
    .map((o) => o.name);
  const list = `${hidden.slice(0, -1).join(", ")}${hidden.length > 1 ? " and " : ""}${hidden.at(-1)}`;
  SIGHTS.push({
    at: sun,
    say: (w) => (hidden.length ? `The Sun is ${w}. Up there with it, outshone: ${list}.` : `The Sun is ${w}. Come back after dark.`),
  });
}

// A different sight each hour, from whatever is actually up.
const hourIndex = Math.floor(now.getTime() / 3.6e6);
const sight = SIGHTS[hourIndex % SIGHTS.length];
const lookUp = sight ? sight.say(where(sight.at), sight.at) : "The sky is still too bright for the faint stuff. Give it half an hour.";

const local = new Date(now.getTime() + PLACE.utcOffset * 3.6e6);
const pad = (n) => String(n).padStart(2, "0");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const timeText = `${DAYS[local.getUTCDay()]} ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()}, ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())} ${PLACE.zone}`;
const lstText = `${pad(Math.floor(lst / 15))}:${pad(Math.floor(((lst / 15) % 1) * 60))}`;
const up = (o) => `${Math.round(o.alt)}° up ${COMPASS[wind(o.az)]}`;
const sunText = h > -0.83 ? `${Math.round(h)}° up · ${daylight}` : `${Math.round(-h)}° below ${h < -18 ? "the horizon " : ""}· ${daylight}`;
const moonText = `${phase.name}, ${Math.round(phase.fraction * 100)}% lit · ${moon.alt > 0 ? up(moon) : "below the horizon"}`;
const planetsUp = planets.filter((p) => p.alt > 0).sort((a, b) => a.mag - b.mag);
const planetText = planetsUp.length ? planetsUp.slice(0, 3).map((p) => `${p.name} ${Math.round(p.alt)}° ${COMPASS[wind(p.az)]}`).join(" · ") : "none above the horizon";

// ---------------------------------------------------------------- drawing

function render(t) {
  const { dark } = t;
  const random = rng(hourIndex);
  const [zenith, horizonColor] = skyAt(h);
  const domeBase = dark ? zenith : "#faf6ea";
  // Pale names vanish against a blue daytime sky; switch to dark ink there.
  const dayInk = dark && h > -3;
  const ink = (night) => (dayInk ? "#0f1f3d" : night);
  const gold = dayInk ? "#6a4300" : t.accent;
  // On paper the band is part of the chart, so it never disappears entirely.
  const milkyWay = dark ? milkyWayDark : 0.3 + 0.7 * milkyWayDark;
  const out = [];
  const defs = [];
  const css = [];

  // Labels must not collide with each other or with the bodies they name.
  const taken = [];
  const inside = ([x0, y0, x1, y1]) =>
    [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].every(([x, y]) => Math.hypot(x - DOME.cx, y - DOME.cy) < DOME.R - 5);
  const overlaps = (a) => taken.some((b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]);
  const reserve = (x, y, r) => taken.push([x - r, y - r, x + r, y + r]);
  function label(x, y, text, { size = 11, gap = 8, fill = t.ink, opacity = 0.85, italic = true, cls = "serif", center = false } = {}) {
    const w = text.length * size * 0.5;
    const spots = center
      ? [[x, y + size + gap, "middle"], [x, y - gap - 2, "middle"], [x + gap * 1.5, y + size * 0.35, "start"], [x - gap * 1.5, y + size * 0.35, "end"], [x, y + size + gap * 2.4, "middle"], [x, y - gap * 2.4, "middle"]]
      : [[x + gap, y + size * 0.35, "start"], [x - gap, y + size * 0.35, "end"], [x, y - gap - 2, "middle"], [x, y + size + gap, "middle"]];
    for (const [tx, ty, anchor] of spots) {
      const x0 = anchor === "start" ? tx : anchor === "end" ? tx - w : tx - w / 2;
      const box = [x0 - 1, ty - size * 0.8, x0 + w + 1, ty + size * 0.3];
      if (!inside(box) || overlaps(box)) continue;
      taken.push(box);
      return `<text x="${r1(tx)}" y="${r1(ty)}" text-anchor="${anchor}" class="${cls}" font-size="${size}"${italic ? ' font-style="italic"' : ""} fill="${fill}" fill-opacity="${opacity}">${esc(text)}</text>`;
    }
    return "";
  }

  defs.push(`<clipPath id="dome"><circle cx="${DOME.cx}" cy="${DOME.cy}" r="${DOME.R}"/></clipPath>`);
  defs.push(`<filter id="mw" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><feGaussianBlur stdDeviation="${dark ? 9 : 7}"/></filter>`);
  defs.push(`<filter id="rift" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><feGaussianBlur stdDeviation="3.2"/></filter>`);
  defs.push(`<filter id="soft" x="-2" y="-2" width="5" height="5"><feGaussianBlur stdDeviation="2.4"/></filter>`);
  if (!dark) defs.push(grainFilter("grain", 0.55));

  // The dome: sky colour, the Sun's glow, and in daylight a wash over the paper.
  defs.push(`<radialGradient id="sky" cx="${DOME.cx}" cy="${DOME.cy}" r="${DOME.R}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${zenith}"/><stop offset=".72" stop-color="${mix(zenith, horizonColor, 0.45)}"/><stop offset="1" stop-color="${horizonColor}"/></radialGradient>`);
  out.push(`<circle cx="${DOME.cx}" cy="${DOME.cy}" r="${DOME.R}" fill="${dark ? "url(#sky)" : domeBase}"/>`);
  if (!dark && h > -8) out.push(`<circle cx="${DOME.cx}" cy="${DOME.cy}" r="${DOME.R}" fill="url(#sky)" opacity="${r2(lerp(0, 0.16, (h + 8) / 10))}"/>`);
  if (h > -15) {
    const [sx, sy] = project({ alt: Math.max(h, -35), az: sun.az });
    const glow = h > 6 ? "#fff1cf" : h > -6 ? "#ffad78" : "#c4707c";
    const strength = (h > 6 ? 0.35 : h > -6 ? 0.62 : lerp(0, 0.4, (h + 15) / 9)) * (dark ? 1 : 0.35);
    defs.push(`<radialGradient id="glow" cx="${r1(sx)}" cy="${r1(sy)}" r="${DOME.R * 1.05}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${glow}" stop-opacity="${r2(strength)}"/><stop offset=".55" stop-color="${glow}" stop-opacity="${r2(strength * 0.3)}"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>`);
    out.push(`<circle cx="${DOME.cx}" cy="${DOME.cy}" r="${DOME.R}" fill="url(#glow)"/>`);
  }

  const sky = []; // everything clipped to the dome

  // Bima Sakti: a band along the galactic equator, brightest towards Sagittarius,
  // with the Great Rift down its middle and the Coalsack beside the Cross.
  const angDist = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  const bright = (l) =>
    0.26 + 0.74 * Math.exp(-((angDist(l, 0) / 30) ** 2)) + 0.3 * Math.exp(-((angDist(l, 75) / 20) ** 2)) + 0.32 * Math.exp(-((angDist(l, 300) / 24) ** 2));
  const halfWidth = (l) => 6.5 + 8 * Math.exp(-((angDist(l, 0) / 28) ** 2));
  const gal = (l, b) => fromJ2000(...A.galacticToEquatorial(l, b));
  const band = [];
  const rift = [];
  const mwLight = dark ? "#b9c7ef" : "#8a86b4"; // a violet wash, so it stays grey-blue on cream paper
  // Near the horizon the band drowns in thicker air, as it does outdoors.
  const extinction = (alt) => clamp01((alt + 3) / 30) ** 0.9;
  // Star clouds: uneven knots of light that make the band read as the real thing.
  // Drawn up front from a fixed seed, so they stay put in the sky from hour to hour.
  const clouds = rng(4242);
  const knots = Array.from({ length: 120 }, () => Array.from({ length: 2 }, () => [clouds(), clouds(), clouds(), clouds()]));
  for (let l = 0; l < 360; l += 3) {
    const [a, b] = [gal(l, 0), gal(l + 3, 0)];
    if (a.alt < -12 && b.alt < -12) continue;
    const [p, q] = [project(a), project(b)];
    const hw = halfWidth(l + 1.5);
    const [e1, e2] = [project(gal(l + 1.5, hw)), project(gal(l + 1.5, -hw))];
    const width = Math.min(Math.hypot(e1[0] - e2[0], e1[1] - e2[1]), DOME.R * 0.32);
    const fade = bright(l + 1.5) * milkyWay * extinction((a.alt + b.alt) / 2) * (dark ? 1 : 0.8);
    const seg = `x1="${r1(p[0])}" y1="${r1(p[1])}" x2="${r1(q[0])}" y2="${r1(q[1])}"`;
    for (const [k, o] of [[1.7, 0.08], [1, 0.13], [0.42, 0.16]]) {
      band.push(`<line ${seg} stroke-width="${r1(width * k)}" stroke-opacity="${r2(o * fade)}"/>`);
    }
    for (const [u, v, size, glow] of knots[l / 3]) {
      const cl = l + u * 3;
      const cb = (v - 0.5) * hw * 1.1;
      const c = gal(cl, cb);
      if (c.alt < -5) continue;
      const [cx, cy] = project(c);
      const edge = project(gal(cl, cb + hw * (0.15 + 0.3 * size)));
      const rr = Math.min(Math.hypot(edge[0] - cx, edge[1] - cy), DOME.R * 0.12);
      const o = (0.05 + 0.14 * glow) * bright(cl) * milkyWay * extinction(c.alt) * (dark ? 1 : 0.8);
      band.push(`<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(rr)}" fill="${mwLight}" stroke="none" fill-opacity="${r2(o)}"/>`);
    }
  }
  for (let l = 6; l < 80; l += 3) {
    const [a, b] = [gal(l, 0.6), gal(l + 3, 0.6)];
    if (a.alt < -10 && b.alt < -10) continue;
    const [p, q] = [project(a), project(b)];
    const [e1, e2] = [project(gal(l + 1.5, 2.2)), project(gal(l + 1.5, -1))];
    rift.push(`<line x1="${r1(p[0])}" y1="${r1(p[1])}" x2="${r1(q[0])}" y2="${r1(q[1])}" stroke-width="${r1(Math.hypot(e1[0] - e2[0], e1[1] - e2[1]))}"/>`);
  }
  const coalsack = gal(301, -1);
  if (coalsack.alt > -5) {
    const [x, y] = project(coalsack);
    const edge = project(gal(304, -1));
    rift.push(`<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(Math.hypot(edge[0] - x, edge[1] - y))}" stroke="none"/>`);
  }
  sky.push(`<g filter="url(#mw)" stroke="${mwLight}" stroke-linecap="round" fill="none">${band.join("")}</g>`);
  sky.push(`<g filter="url(#rift)" stroke="${domeBase}" fill="${domeBase}" stroke-linecap="round" opacity="${r2((dark ? 0.55 : 0.75) * milkyWay)}">${rift.join("")}</g>`);

  // Reference lines: altitude rings, the celestial equator, the ecliptic.
  for (const alt of [30, 60]) {
    sky.push(`<circle cx="${DOME.cx}" cy="${DOME.cy}" r="${r1(DOME.R * Math.tan(((90 - alt) / 2) * RAD))}" fill="none" stroke="${t.grid}" stroke-width=".6" stroke-dasharray="1 4" opacity=".9"/>`);
  }
  const equator = Array.from({ length: 91 }, (_, i) => toHorizon(i * 4, 0));
  sky.push(`<path d="${skyPath(equator)}" fill="none" stroke="${t.grid}" stroke-width=".7" stroke-dasharray="2 3"/>`);
  const eps = A.obliquity(jd);
  const ecliptic = Array.from({ length: 121 }, (_, i) => toHorizon(...A.eclipticToEquatorial(i * 3, 0, eps)));
  sky.push(`<path d="${skyPath(ecliptic)}" fill="none" stroke="${t.accent}" stroke-width=".8" stroke-dasharray="5 4" opacity="${dark ? 0.45 : 0.55}"/>`);
  sky.push(`<path d="M${DOME.cx - 4} ${DOME.cy}h8M${DOME.cx} ${DOME.cy - 4}v8" stroke="${t.muted}" stroke-width=".8" opacity=".7"/>`);

  // Constellation figures.
  const figures = data.lines
    .map(([, path]) => path.map(([ra, dec]) => fromJ2000(ra, dec)))
    .filter((path) => path.some((p) => p.alt > -2))
    .map((path) => skyPath(path, -6))
    .join("");
  sky.push(`<path d="${figures}" fill="none" stroke="${t.line}" stroke-width="${dark ? 0.75 : 0.7}" stroke-linecap="round" stroke-linejoin="round" opacity="${r2((dark ? 0.42 : 0.62) * (0.35 + 0.65 * starlight))}"/>`);

  // Stars, faint first so the bright ones sit on top.
  const starMarks = [];
  for (const s of [...stars].sort((a, b) => b.mag - a.mag)) {
    if (s.alt < -1) continue;
    const [x, y] = project(s);
    const r = starRadius(s.mag);
    const fade = starlight * (s.mag > 4 ? lerp(1, 0.45, (1 - starlight) * 1.5) : 1);
    if (dark) {
      const fill = starColor(s.bv);
      const twinkle = s.mag < 2.3 && starlight > 0.5 ? ` class="tw${Math.floor(random() * 4)}" style="animation-delay:-${r1(random() * 5)}s"` : "";
      const halo = s.mag < 1.2 ? `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r * 2.6)}" fill="${fill}" opacity="${r2(0.22 * fade)}" filter="url(#soft)"/>` : "";
      starMarks.push(`<g${twinkle}>${halo}<circle cx="${r1(x)}" cy="${r1(y)}" r="${r2(r)}" fill="${fill}" opacity="${r2(Math.min(1, fade * (0.55 + 0.15 * (5 - s.mag))))}"/></g>`);
    } else {
      // Engraved style: ink dots, with a ring of bare paper around the bright ones.
      const ring = s.mag < 2.5 ? `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r2(r + 1.3)}" fill="${domeBase}"/>` : "";
      starMarks.push(`${ring}<circle cx="${r1(x)}" cy="${r1(y)}" r="${r2(r * 0.92)}" fill="${t.ink}" opacity="${r2(0.35 + 0.65 * fade)}"/>`);
    }
    if (s.mag < 2.6 && s.alt > 0) reserve(x, y, r + 0.5);
  }
  sky.push(starMarks.join(""));
  css.push(
    "@keyframes tw{0%,100%{opacity:1}45%{opacity:.5}55%{opacity:.8}}",
    ...[3.1, 3.9, 4.7, 5.6].map((d, i) => `.tw${i}{animation:tw ${d}s ease-in-out infinite}`),
  );

  // A meteor, now and then, on dark nights.
  if (dark && isNight) {
    const ang = random() * 360;
    const [mx, my] = [DOME.cx + (random() - 0.5) * DOME.R * 0.9, DOME.cy + (random() - 0.5) * DOME.R * 0.9];
    const [dx, dy] = [Math.cos(ang * RAD), Math.sin(ang * RAD)];
    defs.push(`<linearGradient id="meteor" gradientUnits="userSpaceOnUse" x1="${r1(mx)}" y1="${r1(my)}" x2="${r1(mx - dx * 70)}" y2="${r1(my - dy * 70)}">
      <stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`);
    css.push(`@keyframes meteor{0%,84%{opacity:0;transform:translate(0,0)}86%{opacity:1}93%{opacity:0;transform:translate(${r1(dx * 150)}px,${r1(dy * 150)}px)}100%{opacity:0;transform:translate(${r1(dx * 150)}px,${r1(dy * 150)}px)}}.meteor{animation:meteor 13s linear infinite;animation-delay:-${r1(random() * 8 + 3)}s}`);
    sky.push(`<line class="meteor" x1="${r1(mx)}" y1="${r1(my)}" x2="${r1(mx - dx * 70)}" y2="${r1(my - dy * 70)}" stroke="url(#meteor)" stroke-width="1.3" stroke-linecap="round" opacity="0"/>`);
  }

  // The Sun.
  const bodies = [];
  const labels = [];
  if (h > -1) {
    const [x, y] = project(sun);
    bodies.push(
      dark
        ? `<circle cx="${r1(x)}" cy="${r1(y)}" r="24" fill="#fff3cf" opacity=".35" filter="url(#soft)"/><circle cx="${r1(x)}" cy="${r1(y)}" r="7" fill="#fff6dc"/>`
        : `<circle cx="${r1(x)}" cy="${r1(y)}" r="7" fill="${domeBase}" stroke="${t.ink}" stroke-width="1.2"/><circle cx="${r1(x)}" cy="${r1(y)}" r="1.6" fill="${t.ink}"/>`,
    );
    reserve(x, y, 9);
    labels.push([x, y, "Sun", { gap: 11, fill: dark ? ink("#fff3cf") : t.ink, opacity: 0.95, italic: false, size: 11.5 }]);
  }

  // The Moon: true phase, with the lit limb turned towards the Sun.
  if (moon.alt > -1) {
    const [x, y] = project(moon);
    const [bx, by] = project(toward(moon, sun, 1));
    const angle = (Math.atan2(by - y, bx - x) * 180) / Math.PI;
    const r = 8.5;
    const rx = r * Math.abs(2 * phase.fraction - 1);
    const lit = `M0 ${-r}A${r} ${r} 0 0 1 0 ${r}A${r2(rx)} ${r} 0 0 ${phase.fraction > 0.5 ? 1 : 0} 0 ${-r}Z`;
    bodies.push(
      `<g transform="translate(${r1(x)} ${r1(y)}) rotate(${r1(angle)})">` +
        (dark
          ? `<circle r="${r * 2.6}" fill="#f3ecd8" opacity="${r2(0.12 + 0.28 * phase.fraction)}" filter="url(#soft)"/><circle r="${r}" fill="#1c2438"/><path d="${lit}" fill="#f4eedc"/>`
          : `<circle r="${r}" fill="${t.ink}" opacity=".85"/><path d="${lit}" fill="#fffdf5"/><circle r="${r}" fill="none" stroke="${t.ink}" stroke-width="1"/>`) +
        `</g>`,
    );
    reserve(x, y, r + 2);
    labels.push([x, y, "Moon", { gap: 13, fill: dark ? ink("#f4eedc") : t.ink, opacity: 0.95, italic: false, size: 11.5 }]);
  }

  // Planets, drawn larger than life so they read at a glance.
  for (const p of planets) {
    if (p.alt < 0) continue;
    const [x, y] = project(p);
    const r = Math.max(2, Math.min(4.2, 2.3 + (1.2 - p.mag) * 0.45));
    bodies.push(
      dark
        ? `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r2(r * 2.4)}" fill="${PLANET_COLOR[p.name]}" opacity=".25" filter="url(#soft)"/><circle cx="${r1(x)}" cy="${r1(y)}" r="${r2(r)}" fill="${PLANET_COLOR[p.name]}"/>`
        : `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r2(r + 1.4)}" fill="${domeBase}"/><circle cx="${r1(x)}" cy="${r1(y)}" r="${r2(r)}" fill="${t.accent}"/>`,
    );
    reserve(x, y, r + 1);
    labels.push([x, y, p.name, { fill: dark ? ink(PLANET_COLOR[p.name]) : t.accent, opacity: 0.95, italic: false, size: 11 }]);
  }

  // Names: bodies first, then the old Nusantara asterisms, then a few bright stars.
  const text = labels.map(([x, y, s, o]) => label(x, y, s, o));
  for (const a of ASTERISMS) {
    if (a.alt < 7) continue;
    const [x, y] = project(a);
    text.push(label(x, y, a.label, { center: true, size: 11.5, fill: gold, opacity: dark ? 0.9 : 0.95, gap: 10 }));
  }
  const mwPeak = Array.from({ length: 120 }, (_, i) => ({ l: i * 3, ...gal(i * 3, 0) })).sort((a, b) => b.alt - a.alt)[0];
  if (mwPeak.alt > 20 && (dark ? milkyWay > 0.45 : true)) {
    const [x, y] = project(mwPeak);
    const [x2, y2] = project(gal(mwPeak.l + 4, 0));
    let rot = (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI;
    if (rot > 90) rot -= 180;
    if (rot < -90) rot += 180;
    text.push(
      `<text transform="translate(${r1(x)} ${r1(y)}) rotate(${r1(rot)})" dy="-14" text-anchor="middle" class="caps" font-size="9" fill="${dark ? "#c9d4f2" : t.ink}" fill-opacity="${dark ? 0.55 : 0.6}">Bima Sakti</text>`,
    );
  }
  const brightest = stars.filter((s) => s.name && s.alt > 9 && s.mag < 1.3).sort((a, b) => a.mag - b.mag).slice(0, isNight ? 6 : 4);
  for (const s of brightest) {
    const [x, y] = project(s);
    text.push(label(x, y, s.name, { size: 10.5, fill: dark ? ink("#cfd6e8") : t.ink, opacity: (dark ? 0.75 : 0.8) * (dayInk ? 0.8 : 0.4 + 0.6 * starlight) }));
  }

  // Rim and compass ring.
  const ticks = [];
  for (let az = 0; az < 360; az += 5) {
    const len = az % 90 === 0 ? 11 : az % 30 === 0 ? 7 : az % 10 === 0 ? 4.5 : 2.5;
    const [s, c] = [Math.sin(az * RAD), Math.cos(az * RAD)];
    const [r0, r9] = [DOME.R + 4, DOME.R + 4 + len];
    ticks.push(`M${r1(DOME.cx - r0 * s)} ${r1(DOME.cy - r0 * c)}L${r1(DOME.cx - r9 * s)} ${r1(DOME.cy - r9 * c)}`);
  }
  const cardinal = ["N", "E", "S", "W"].map((n, i) => {
    const az = i * 90;
    const rr = DOME.R + 27;
    return `<text x="${r1(DOME.cx - rr * Math.sin(az * RAD))}" y="${r1(DOME.cy - rr * Math.cos(az * RAD) + 5)}" text-anchor="middle" class="serif" font-size="15" fill="${t.ink}">${n}</text>`;
  });
  const rim = dark
    ? `<circle cx="${DOME.cx}" cy="${DOME.cy}" r="${DOME.R}" fill="none" stroke="#33426a" stroke-width="1"/><circle cx="${DOME.cx}" cy="${DOME.cy}" r="${DOME.R + 4}" fill="none" stroke="${t.rule}" stroke-width=".8"/>`
    : `<circle cx="${DOME.cx}" cy="${DOME.cy}" r="${DOME.R}" fill="none" stroke="${t.ink}" stroke-width="1.4"/><circle cx="${DOME.cx}" cy="${DOME.cy}" r="${DOME.R + 4}" fill="none" stroke="${t.ink}" stroke-width=".6"/>`;

  // The left column: who, and what the sky is doing right now.
  const x0 = 56;
  const xv = 150;
  const row = (y, key, value) =>
    `<text x="${x0}" y="${y}" class="caps" font-size="9.5" fill="${t.muted}">${esc(key)}</text><text x="${xv}" y="${y}" class="serif" font-size="14.5" fill="${t.ink}">${esc(value)}</text>`;
  const lookLines = wrap(lookUp, 54).slice(0, 3);
  const panel = `
  <g>
    <circle class="pulse" cx="${x0 + 4}" cy="66" r="3.6" fill="${t.live}"/>
    <text x="${x0 + 16}" y="70" class="caps" font-size="11" fill="${t.accent}">Live · the sky over ${esc(PLACE.name)}</text>
    <text x="${x0 - 2}" y="128" class="serif" font-size="48" fill="${t.ink}">${esc(PERSON.name)}</text>
    <text x="${x0}" y="162" class="serif" font-size="20" font-style="italic" fill="${t.muted}">${esc(PERSON.tagline)}</text>
    <path d="M${x0} 192H470" stroke="${t.rule}" stroke-width="${dark ? 1 : 0.8}"/>
    ${row(226, "Time", timeText)}
    ${row(254, "Sun", sunText)}
    ${row(282, "Moon", moonText)}
    ${row(310, "Planets", planetText)}
    <path d="M${x0} 336H470" stroke="${t.rule}" stroke-width="${dark ? 1 : 0.8}"/>
    <text x="${x0}" y="366" class="caps" font-size="9.5" fill="${t.accent}">Look up</text>
    ${lookLines.map((l, i) => `<text x="${x0}" y="${392 + i * 23}" class="serif" font-size="16.5" font-style="italic" fill="${t.ink}">${esc(l)}</text>`).join("\n    ")}
    <text x="${x0}" y="478" class="caps" font-size="9" fill="${t.muted}" fill-opacity=".85">LST ${lstText} · ${data.stars.length.toLocaleString("en-US")} stars · ${constellations} constellations · redrawn hourly</text>
  </g>`;

  const title = `The sky over ${PLACE.name} on ${timeText}: ${daylight}; the Moon is ${phase.name.toLowerCase()}, ${moon.alt > 0 ? where(moon) : "below the horizon"}. ${lookUp}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title">
  <title id="title">${esc(title)}</title>
  <defs>
    ${defs.join("\n    ")}
    ${baseStyle(t, css.join("\n      "))}
  </defs>
  ${frame(t, W, H)}
  ${panel}
  ${out.join("\n  ")}
  <g clip-path="url(#dome)">
    ${sky.join("\n    ")}
    ${bodies.join("\n    ")}
    ${text.filter(Boolean).join("\n    ")}
  </g>
  ${rim}
  <path d="${ticks.join("")}" stroke="${t.ink}" stroke-width=".7" opacity="${dark ? 0.55 : 0.8}"/>
  ${cardinal.join("\n  ")}
</svg>
`;
}

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "sky.svg"), render(THEMES.light));
await writeFile(join(outDir, "sky-dark.svg"), render(THEMES.dark));
console.log(
  JSON.stringify({
    at: now.toISOString(),
    local: timeText,
    sun: { alt: r1(sun.alt), az: r1(sun.az), daylight },
    moon: { alt: r1(moon.alt), az: r1(moon.az), phase: phase.name, lit: r2(phase.fraction) },
    planetsUp: planetsUp.map((p) => `${p.name} ${r1(p.alt)}`),
    starsUp: stars.filter((s) => s.alt > 0).length,
    lookUp,
  }),
);
