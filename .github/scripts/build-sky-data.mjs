// One-off tool that produces .github/data/sky.json, the star catalogue that
// sky.mjs draws from. It is not part of the hourly workflow: the trimmed data
// is committed so the workflow never depends on a third-party download.
//
// Source: d3-celestial by Olaf Frohn (BSD-3-Clause), pinned to one commit.
// Its star positions come from XHIP (Anderson & Francis 2012) and its
// constellation figures from the IAU.
//
// Usage: node .github/scripts/build-sky-data.mjs

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const COMMIT = "7e720a3de062059d4c5400a379146a601d9010e0";
const BASE = `https://raw.githubusercontent.com/ofrohn/d3-celestial/${COMMIT}/data`;
const MAG_LIMIT = 5.0; // roughly what a dark-ish suburban sky shows
const NAMED_LIMIT = 2.0; // keep proper names for stars this bright or brighter

const get = async (file) => {
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.json();
};

const [stars, lines, constellations, names] = await Promise.all(
  ["stars.6.json", "constellations.lines.json", "constellations.json", "starnames.json"].map(get),
);

// d3-celestial stores right ascension as a longitude in [-180, 180).
const ra = (lon) => +(((lon % 360) + 360) % 360).toFixed(3);
const dec = (lat) => +lat.toFixed(3);

const catalogue = stars.features
  .filter((f) => f.properties.mag <= MAG_LIMIT)
  .sort((a, b) => a.properties.mag - b.properties.mag)
  .map((f) => {
    const [lon, lat] = f.geometry.coordinates;
    const bv = Number.parseFloat(f.properties.bv);
    const row = [ra(lon), dec(lat), +f.properties.mag.toFixed(2), Number.isFinite(bv) ? +bv.toFixed(2) : 0.6];
    const name = names[f.id]?.name;
    if (f.properties.mag <= NAMED_LIMIT && name) row.push(name);
    return row;
  });

const figures = lines.features.flatMap((f) =>
  f.geometry.coordinates.map((path) => [f.id, path.map(([lon, lat]) => [ra(lon), dec(lat)])]),
);

const labels = Object.fromEntries(
  constellations.features.map((f) => {
    const [lon, lat] = f.geometry.coordinates;
    return [f.id, [ra(lon), dec(lat), f.properties.name]];
  }),
);

const data = {
  about:
    `Stars brighter than magnitude ${MAG_LIMIT} (J2000, [ra, dec, mag, b-v, name?]), IAU constellation figures ` +
    `and label points, trimmed from d3-celestial ${COMMIT.slice(0, 7)} by Olaf Frohn (BSD-3-Clause, see ` +
    `LICENSE-d3-celestial.txt). Star data: XHIP, Anderson & Francis (2012). Rebuild with build-sky-data.mjs.`,
  stars: catalogue,
  lines: figures,
  labels,
};

const out = fileURLToPath(new URL("../data/sky.json", import.meta.url));
// One star or figure per line keeps the file diffable without bloating it.
const list = (rows) => `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]`;
const json = `{\n"about": ${JSON.stringify(data.about)},\n"stars": ${list(data.stars)},\n"lines": ${list(
  data.lines,
)},\n"labels": ${JSON.stringify(data.labels)}\n}\n`;
JSON.parse(json); // fail loudly rather than write a broken file
await writeFile(out, json);
console.log(`${catalogue.length} stars, ${figures.length} figure paths -> ${out}`);
