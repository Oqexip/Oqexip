// Small, dependency-free positional astronomy: enough to draw the naked-eye
// sky for any instant, to a fraction of a degree.
//
// - Sidereal time: IAU 1982 GMST (Meeus 12.4).
// - Precession J2000 -> date: IAU 1976 angles (Meeus 21.2-21.4).
// - Sun and Moon: low-precision series from the Astronomical Almanac
//   (about 0.01 deg for the Sun, 0.3 deg for the Moon).
// - Planets: JPL approximate Keplerian elements, valid 1800-2050
//   (Standish, "Keplerian Elements for Approximate Positions of the Major Planets").
//
// Angles are in degrees unless a name says otherwise.

const RAD = Math.PI / 180;
const sin = (d) => Math.sin(d * RAD);
const cos = (d) => Math.cos(d * RAD);
const asin = (x) => Math.asin(Math.max(-1, Math.min(1, x))) / RAD;
const atan2 = (y, x) => Math.atan2(y, x) / RAD;
export const norm360 = (d) => ((d % 360) + 360) % 360;

export const julianDay = (date) => date.getTime() / 86400000 + 2440587.5;
const centuries = (jd) => (jd - 2451545.0) / 36525;

/** Greenwich mean sidereal time. */
export function gmst(jd) {
  const t = centuries(jd);
  return norm360(280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t - (t * t * t) / 38710000);
}

/** Mean obliquity of the ecliptic (Meeus 22.2, truncated). */
export const obliquity = (jd) => {
  const t = centuries(jd);
  return 23.439291111 - 0.013004167 * t - 1.6389e-7 * t * t + 5.0361e-7 * t * t * t;
};

/** Returns a function that precesses J2000 equatorial coordinates to the given date. */
export function precessor(jd) {
  const t = centuries(jd);
  const arc = (a, b, c) => (a * t + b * t * t + c * t * t * t) / 3600;
  const zeta = arc(2306.2181, 0.30188, 0.017998);
  const z = arc(2306.2181, 1.09468, 0.018203);
  const theta = arc(2004.3109, -0.42665, -0.041833);
  const [st, ct] = [sin(theta), cos(theta)];
  return (ra, dec) => {
    const [sd, cd] = [sin(dec), cos(dec)];
    const az = ra + zeta;
    const A = cd * sin(az);
    const B = ct * cd * cos(az) - st * sd;
    const C = st * cd * cos(az) + ct * sd;
    return [norm360(atan2(A, B) + z), asin(C)];
  };
}

/** Ecliptic (lambda, beta) to equatorial (ra, dec) for obliquity eps. */
export function eclipticToEquatorial(lambda, beta, eps) {
  const ra = atan2(sin(lambda) * cos(eps) - (sin(beta) / cos(beta)) * sin(eps), cos(lambda));
  const dec = asin(sin(beta) * cos(eps) + cos(beta) * sin(eps) * sin(lambda));
  return [norm360(ra), dec];
}

/** Returns a function mapping equatorial-of-date (ra, dec) to horizontal (alt, az from north through east). */
export function horizon(lst, lat) {
  const [sl, cl] = [sin(lat), cos(lat)];
  return (ra, dec) => {
    const h = lst - ra;
    const [sd, cd] = [sin(dec), cos(dec)];
    const alt = asin(sl * sd + cl * cd * cos(h));
    const az = norm360(atan2(-cd * sin(h), sd * cl - cd * cos(h) * sl));
    return { alt, az };
  };
}

/** Galactic (l, b) to J2000 equatorial (ra, dec). */
export function galacticToEquatorial(l, b) {
  const [raNgp, decNgp, lNcp] = [192.85948, 27.12825, 122.93192];
  const dl = lNcp - l;
  const dec = asin(sin(b) * sin(decNgp) + cos(b) * cos(decNgp) * cos(dl));
  const ra = raNgp + atan2(cos(b) * sin(dl), sin(b) * cos(decNgp) - cos(b) * sin(decNgp) * cos(dl));
  return [norm360(ra), dec];
}

/** Apparent geocentric Sun, mean equinox of date. Distance in AU. */
export function sun(jd) {
  const n = jd - 2451545.0;
  const L = 280.46 + 0.9856474 * n;
  const g = 357.528 + 0.9856003 * n;
  const lambda = norm360(L + 1.915 * sin(g) + 0.02 * sin(2 * g));
  const dist = 1.00014 - 0.01671 * cos(g) - 0.00014 * cos(2 * g);
  const [ra, dec] = eclipticToEquatorial(lambda, 0, obliquity(jd));
  return { lambda, beta: 0, ra, dec, dist };
}

/** Geocentric Moon, mean equinox of date. Parallax in degrees, distance in km. */
export function moon(jd) {
  const t = centuries(jd);
  const lambda = norm360(
    218.32 +
      481267.881 * t +
      6.29 * sin(135.0 + 477198.87 * t) -
      1.27 * sin(259.3 - 413335.36 * t) +
      0.66 * sin(235.7 + 890534.22 * t) +
      0.21 * sin(269.9 + 954397.74 * t) -
      0.19 * sin(357.5 + 35999.05 * t) -
      0.11 * sin(186.5 + 966404.03 * t),
  );
  const beta =
    5.13 * sin(93.3 + 483202.02 * t) +
    0.28 * sin(228.2 + 960400.89 * t) -
    0.28 * sin(318.3 + 6003.15 * t) -
    0.17 * sin(217.6 - 407332.21 * t);
  const parallax =
    0.9508 +
    0.0518 * cos(135.0 + 477198.87 * t) +
    0.0095 * cos(259.3 - 413335.36 * t) +
    0.0078 * cos(235.7 + 890534.22 * t) +
    0.0028 * cos(269.9 + 954397.74 * t);
  const [ra, dec] = eclipticToEquatorial(lambda, beta, obliquity(jd));
  return { lambda, beta, ra, dec, parallax, dist: 6378.14 / sin(parallax) };
}

/** Illuminated fraction and phase of the Moon (Meeus 48). */
export function moonPhase(jd) {
  const s = sun(jd);
  const m = moon(jd);
  const elongation = Math.acos(cos(m.beta) * cos(m.lambda - s.lambda)) / RAD;
  const phaseAngle = atan2(s.dist * 149597870.7 * sin(elongation), m.dist - s.dist * 149597870.7 * cos(elongation));
  const fraction = (1 + cos(phaseAngle)) / 2;
  const age = norm360(m.lambda - s.lambda); // 0 new, 90 first quarter, 180 full
  const waxing = age < 180;
  const name =
    fraction < 0.03
      ? "New Moon"
      : fraction > 0.97
        ? "Full Moon"
        : Math.abs(fraction - 0.5) < 0.04
          ? waxing
            ? "First quarter"
            : "Last quarter"
          : `${waxing ? "Waxing" : "Waning"} ${fraction < 0.5 ? "crescent" : "gibbous"}`;
  return { fraction, waxing, age, name };
}

// a (AU), e, I, L, long. perihelion, long. ascending node; then rates per Julian century.
const ELEMENTS = {
  Mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  Venus: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
  Earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
  Mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  Jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  Saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
};

// Visual magnitude at unit distances as a function of phase angle i
// (Astronomical Almanac 1984, via Meeus 41). Saturn's rings are ignored.
const BRIGHTNESS = {
  Mercury: (i) => -0.42 + 0.038 * i - 0.000273 * i * i + 2e-6 * i ** 3,
  Venus: (i) => -4.4 + 0.0009 * i + 0.000239 * i * i - 6.5e-7 * i ** 3,
  Mars: (i) => -1.52 + 0.016 * i,
  Jupiter: (i) => -9.4 + 0.005 * i,
  Saturn: () => -8.88,
};

function heliocentric(name, t) {
  const [base, rate] = ELEMENTS[name];
  const [a, e, I, L, peri, node] = base.map((v, k) => v + rate[k] * t);
  const w = peri - node;
  let M = norm360(L - peri);
  if (M > 180) M -= 360;
  // Kepler's equation by Newton iteration, in radians.
  const Mr = M * RAD;
  let E = Mr + e * Math.sin(Mr);
  for (let k = 0; k < 8; k++) E -= (E - e * Math.sin(E) - Mr) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const [cw, sw, cn, sn, ci, si] = [cos(w), sin(w), cos(node), sin(node), cos(I), sin(I)];
  return [
    (cw * cn - sw * sn * ci) * xp + (-sw * cn - cw * sn * ci) * yp,
    (cw * sn + sw * cn * ci) * xp + (-sw * sn + cw * cn * ci) * yp,
    sw * si * xp + cw * si * yp,
  ];
}

/** Geocentric planets with J2000 equatorial coordinates and a visual magnitude estimate. */
export function planets(jd) {
  const t = centuries(jd);
  const earth = heliocentric("Earth", t);
  const eps0 = 23.43928;
  return Object.keys(BRIGHTNESS).map((name) => {
    const p = heliocentric(name, t);
    const g = p.map((v, k) => v - earth[k]);
    const delta = Math.hypot(...g);
    const r = Math.hypot(...p);
    const lambda = norm360(atan2(g[1], g[0]));
    const beta = asin(g[2] / delta);
    const [ra, dec] = eclipticToEquatorial(lambda, beta, eps0);
    const R = Math.hypot(...earth);
    const phaseAngle = Math.acos((r * r + delta * delta - R * R) / (2 * r * delta)) / RAD;
    const mag = BRIGHTNESS[name](phaseAngle) + 5 * Math.log10(r * delta);
    return { name, ra, dec, mag, delta };
  });
}

/** Angular separation between two equatorial positions. */
export function separation(ra1, dec1, ra2, dec2) {
  return Math.acos(Math.max(-1, Math.min(1, sin(dec1) * sin(dec2) + cos(dec1) * cos(dec2) * cos(ra1 - ra2)))) / RAD;
}
