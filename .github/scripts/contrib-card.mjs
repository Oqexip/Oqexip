// Builds the contribution stats cards (total, current streak, longest streak)
// straight from the GitHub GraphQL API, so the README shows the same numbers
// as the profile's contribution calendar instead of a third-party cached copy.
//
// Usage: GITHUB_TOKEN=... node contrib-card.mjs <user> <out-dir>

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { THEMES, contributionSky } from "./lib/contrib-sky.mjs";

const [user = "Oqexip", outDir = "dist"] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN is not set");

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(JSON.stringify(body.errors ?? body));
  return body.data;
}

const { user: info } = await gql(
  `query($login: String!) {
    user(login: $login) { contributionsCollection { contributionYears } }
  }`,
  { login: user },
);

// One query per year: the API caps a contributionsCollection at one year.
const days = [];
for (const year of info.contributionsCollection.contributionYears) {
  const data = await gql(
    `query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar { weeks { contributionDays { date contributionCount } } }
        }
      }
    }`,
    { login: user, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` },
  );
  for (const week of data.user.contributionsCollection.contributionCalendar.weeks) {
    for (const d of week.contributionDays) days.push({ date: d.date, count: d.contributionCount });
  }
}

// Keep one entry per date, in order, and drop future days in the calendar.
const today = new Date().toISOString().slice(0, 10);
const byDate = new Map(days.filter((d) => d.date <= today).map((d) => [d.date, d.count]));
const calendar = [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));

const total = calendar.reduce((sum, d) => sum + d.count, 0);
const firstDay = calendar.find((d) => d.count > 0)?.date ?? today;

let longest = { length: 0, start: null, end: null };
let run = { length: 0, start: null, end: null };
for (const d of calendar) {
  if (d.count > 0) {
    run = run.length ? { ...run, length: run.length + 1, end: d.date } : { length: 1, start: d.date, end: d.date };
    if (run.length > longest.length) longest = run;
  } else {
    run = { length: 0, start: null, end: null };
  }
}

// The current streak survives a day with no contributions *yet* today.
let current = { length: 0, start: null, end: null };
let i = calendar.length - 1;
if (i >= 0 && calendar[i].count === 0) i--;
if (i >= 0 && calendar[i].count > 0) {
  const end = calendar[i].date;
  let length = 0;
  while (i >= 0 && calendar[i].count > 0) { length++; i--; }
  current = { length, start: calendar[i + 1].date, end };
}

const fmt = (iso, withYear = true) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC",
  });
const range = (s) => {
  if (!s.start) return "No streak yet";
  const sameYear = s.start.slice(0, 4) === s.end.slice(0, 4) && s.end.slice(0, 4) === today.slice(0, 4);
  return s.start === s.end ? fmt(s.start, !sameYear) : `${fmt(s.start, !sameYear)} - ${fmt(s.end, !sameYear)}`;
};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const themes = {
  light: { bg: "#FFFFFF", stroke: "#D0D7DE", accent: "#0969DA", text: "#1F2328", muted: "#59636E" },
  dark: { bg: "#0D1117", stroke: "#30363D", accent: "#58A6FF", text: "#C9D1D9", muted: "#8B949E" },
};

function card(t) {
  const font = `font-family="'Segoe UI', Ubuntu, 'Helvetica Neue', sans-serif"`;
  const col = (x, value, label, sub, color) => `
    <g transform="translate(${x},0)" text-anchor="middle" ${font}>
      <text y="79" font-size="28" font-weight="700" fill="${t.text}">${esc(value)}</text>
      <text y="${label.y}" font-size="14" fill="${color}">${esc(label.text)}</text>
      <text y="${label.y + 26}" font-size="12" fill="${t.muted}">${esc(sub)}</text>
    </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="195" viewBox="0 0 495 195" role="img" aria-label="${esc(
    `${total} total contributions, current streak ${current.length} days, longest streak ${longest.length} days`,
  )}">
  <rect width="495" height="195" rx="4.5" fill="${t.bg}"/>
  <line x1="165" y1="28" x2="165" y2="170" stroke="${t.stroke}"/>
  <line x1="330" y1="28" x2="330" y2="170" stroke="${t.stroke}"/>
  ${col(82.5, total.toLocaleString("en-US"), { text: "Total Contributions", y: 115 }, `${fmt(firstDay)} - Present`, t.text)}
  <circle cx="247.5" cy="71" r="40" fill="none" stroke="${t.accent}" stroke-width="5"/>
  <g transform="translate(247.5,0)" text-anchor="middle" ${font}>
    <text y="80" font-size="28" font-weight="700" fill="${t.text}">${current.length}</text>
    <text y="140" font-size="14" font-weight="700" fill="${t.accent}">Current Streak</text>
    <text y="166" font-size="12" fill="${t.muted}">${esc(range(current))}</text>
  </g>
  ${col(412.5, longest.length, { text: "Longest Streak", y: 115 }, range(longest), t.text)}
</svg>
`;
}

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "contribution-stats.svg"), card(themes.light));
await writeFile(join(outDir, "contribution-stats-dark.svg"), card(themes.dark));
// The same numbers, drawn as a year of stars for the README.
const stats = { calendar, total, firstDay, current, longest };
await writeFile(join(outDir, "contribution-sky.svg"), contributionSky(stats, THEMES.light));
await writeFile(join(outDir, "contribution-sky-dark.svg"), contributionSky(stats, THEMES.dark));
console.log(JSON.stringify({ total, firstDay, current, longest }));
