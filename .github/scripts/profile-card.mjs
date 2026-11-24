// The profile header: who I am, and the stack I build across drawn as a
// schematic, one chip per layer on a shared bus, from pixels down to pins.
// The "Now" line is live: the public repository pushed to most recently.
//
// Usage: GITHUB_TOKEN=... node profile-card.mjs <user> <out-dir>
// Without a token it still renders, just without the "Now" line.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { THEMES, baseStyle, esc, frame, grainFilter, r1, wrap } from "./lib/atlas.mjs";

const [user = "Oqexip", outDir = "dist"] = process.argv.slice(2);

const PERSON = {
  name: "Ilham Sikumbang",
  role: "Fullstack developer · Indonesia",
  tagline: "From pixels to pins.",
  facts: [
    ["Builds", "web apps, front to back"],
    ["Tinkers", "microcontrollers and sensors"],
    ["Learning", "AI/ML, starting with vision"],
  ],
  bio: "Happiest when a website and a circuit end up in the same project.",
  status: "Status: alive · open to new challenges",
};

// Each layer of the stack is a chip on the bus; projects are the ones that live there.
const LAYERS = [
  { ref: "U1", name: "Interface", io: "DOM · canvas · WASM", tech: ["TypeScript", "React", "Next.js", "Tailwind", "Vite"], projects: ["Porto", "EasyVert", "Asterism"] },
  { ref: "U2", name: "Server", io: "HTTP · SQL", tech: ["PHP", "Laravel", "Node.js", "MySQL", "PostgreSQL"], projects: ["OmongIn", "LSP E-Ticketing"] },
  { ref: "U3", name: "Vision", io: "webcam frames", tech: ["Python", "OpenCV", "MediaPipe", "NumPy"], projects: ["handTracking"], learning: true },
  { ref: "U4", name: "Device", io: "GPIO · I²C · SPI · PWM", tech: ["C++", "Arduino", "ESP32", "MQTT"], projects: ["tetrisNano", "Sedia Aku Sebelum Banjir"] },
];
const TOOLS = ["Git", "GitHub Actions", "Docker", "Tinkercad"];
const DISPLAY = { sediaAkuSebelumBanjir: "Sedia Aku Sebelum Banjir", "LSP_E-Ticketing": "LSP E-Ticketing" };

const W = 1000;
const H = 440;
const CHIP = { x: 500, w: 448, h: 72, top: 44, pitch: 84 };
const BUS_X = 474;

/** The public, non-fork repository pushed to most recently, other than this profile repo. */
async function latestPush() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query($login: String!) {
          user(login: $login) {
            repositories(first: 5, privacy: PUBLIC, isFork: false, ownerAffiliations: OWNER, orderBy: {field: PUSHED_AT, direction: DESC}) {
              nodes { name pushedAt }
            }
          }
        }`,
        variables: { login: user },
      }),
    });
    const body = await res.json();
    if (!res.ok || body.errors) throw new Error(JSON.stringify(body.errors ?? body));
    return body.data.user.repositories.nodes.find((r) => r.name.toLowerCase() !== user.toLowerCase()) ?? null;
  } catch (err) {
    console.warn(`Skipping the "Now" line: ${err.message}`);
    return null;
  }
}

function ago(iso, now = Date.now()) {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (min < 60) return min <= 1 ? "just now" : `${min} minutes ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return days === 1 ? "yesterday" : `${days} days ago`;
  return `on ${new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
}

function card(t, now) {
  const { dark } = t;
  const chipFill = dark ? "#0b1226" : "#f8f3e6";
  const chipStroke = dark ? t.grid : t.ink;
  const pillFill = dark ? "#111b35" : "none";
  const pillText = dark ? "#c9d1e6" : t.ink;

  // Left column: who, what, and what's happening now.
  const x0 = 56;
  const xv = 150;
  const row = (y, key, value, color = t.ink) =>
    `<text x="${x0}" y="${y}" class="caps" font-size="9.5" fill="${t.muted}">${esc(key)}</text><text x="${xv}" y="${y}" class="serif" font-size="14.5" fill="${color}">${esc(value)}</text>`;
  const facts = PERSON.facts.map(([k, v], i) => row(226 + i * 28, k, v));
  const nowText = now ? `${DISPLAY[now.name] ?? now.name}, pushed ${ago(now.pushedAt)}` : "github.com/" + user;
  facts.push(row(226 + PERSON.facts.length * 28, "Now", nowText, now ? t.accent : t.ink));
  const bio = wrap(PERSON.bio, 44);

  // Right column: the schematic.
  const chips = LAYERS.map((layer, i) => {
    const y = CHIP.top + i * CHIP.pitch;
    const mid = y + CHIP.h / 2;
    const pins = [];
    for (let px = CHIP.x + 22; px < CHIP.x + CHIP.w - 14; px += 22) pins.push(`M${px} ${y}v-4.5M${px} ${y + CHIP.h}v4.5`);
    let px = CHIP.x + 16;
    const pills = layer.tech.map((name) => {
      const w = name.length * 6.8 + 14;
      const pill = `<rect x="${r1(px)}" y="${y + 27}" width="${r1(w)}" height="19" rx="3" fill="${pillFill}" stroke="${chipStroke}" stroke-width="${dark ? 1 : 0.7}" stroke-opacity="${dark ? 1 : 0.7}"/><text x="${r1(px + w / 2)}" y="${y + 40.5}" text-anchor="middle" class="mono" font-size="11" fill="${pillText}">${esc(name)}</text>`;
      px += w + 6;
      return pill;
    });
    const learning = layer.learning
      ? `<text x="${CHIP.x + 46 + layer.name.length * 9.9 + 10}" y="${y + 19}" class="caps" font-size="8.5" fill="${t.accent}">· learning</text>`
      : "";
    return `
    <g>
      <path d="M${BUS_X} ${mid}H${CHIP.x}" stroke="${chipStroke}" stroke-width="1" opacity="${dark ? 0.9 : 0.75}"/>
      <circle cx="${BUS_X}" cy="${mid}" r="2.6" fill="${chipStroke}"/>
      <path d="${pins.join("")}" stroke="${dark ? "#4a5d8f" : t.ink}" stroke-width="1.4" opacity="${dark ? 1 : 0.7}"/>
      <rect x="${CHIP.x}" y="${y}" width="${CHIP.w}" height="${CHIP.h}" rx="4" fill="${chipFill}" stroke="${chipStroke}" stroke-width="${dark ? 1 : 1.1}"/>
      <circle class="led led${i}" cx="${CHIP.x + 14}" cy="${y + 15}" r="2.6" fill="${t.accent}"/>
      <text x="${CHIP.x + 24}" y="${y + 19}" class="caps" font-size="10.5" fill="${t.accent}">${layer.ref}</text>
      <text x="${CHIP.x + 46}" y="${y + 19}" class="caps" font-size="10.5" fill="${t.ink}">${esc(layer.name)}</text>
      ${learning}
      <text x="${CHIP.x + CHIP.w - 14}" y="${y + 19}" text-anchor="end" class="caps" font-size="8.5" fill="${t.muted}">${esc(layer.io)}</text>
      ${pills.join("\n      ")}
      <text x="${CHIP.x + 16}" y="${y + 63}" class="serif" font-size="13.5" font-style="italic" fill="${t.muted}">→ ${esc(layer.projects.join(" · "))}</text>
    </g>`;
  });

  // The bus, with signals running from pixels down to pins.
  const busTop = CHIP.top + CHIP.h / 2;
  const busBottom = CHIP.top + (LAYERS.length - 1) * CHIP.pitch + CHIP.h / 2;
  const travel = busBottom - busTop;
  const pulses = [0, 1.3, 2.6]
    .map((d) => `<circle class="pulse-dot" cx="${BUS_X}" cy="${busTop}" r="3" fill="${t.accent}" style="animation-delay:${d}s"/>`)
    .join("");

  const css = [
    `@keyframes travel{0%{transform:translateY(0);opacity:0}8%{opacity:1}88%{opacity:1}100%{transform:translateY(${travel}px);opacity:0}}`,
    ".pulse-dot{animation:travel 3.9s cubic-bezier(.45,0,.55,1) infinite;opacity:0}",
    "@keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}",
    ...[2.2, 3.1, 1.7, 2.7].map((d, i) => `.led${i}{animation:blink ${d}s steps(2,jump-none) infinite}`),
  ].join("\n      ");

  const title = `${PERSON.name}, ${PERSON.role}. ${PERSON.tagline} Stack: ${LAYERS.map((l) => `${l.name} (${l.tech.join(", ")})`).join("; ")}.${now ? ` Most recent push: ${nowText}.` : ""}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title">
  <title id="title">${esc(title)}</title>
  <defs>
    ${dark ? "" : grainFilter("grain", 0.55)}
    ${baseStyle(t, css)}
  </defs>
  ${frame(t, W, H)}
  <circle class="pulse" cx="${x0 + 4}" cy="66" r="3.6" fill="${t.live}"/>
  <text x="${x0 + 16}" y="70" class="caps" font-size="11" fill="${t.accent}">${esc(PERSON.role)}</text>
  <text x="${x0 - 2}" y="128" class="serif" font-size="48" fill="${t.ink}">${esc(PERSON.name)}</text>
  <text x="${x0}" y="162" class="serif" font-size="20" font-style="italic" fill="${t.muted}">${esc(PERSON.tagline)}</text>
  <path d="M${x0} 192H440" stroke="${t.rule}" stroke-width="${dark ? 1 : 0.8}"/>
  ${facts.join("\n  ")}
  <path d="M${x0} 332H440" stroke="${t.rule}" stroke-width="${dark ? 1 : 0.8}"/>
  ${bio.map((l, i) => `<text x="${x0}" y="${362 + i * 23}" class="serif" font-size="16.5" font-style="italic" fill="${t.ink}">${esc(l)}</text>`).join("\n  ")}
  <text x="${x0}" y="${H - 28}" class="caps" font-size="9" fill="${t.muted}">${esc(PERSON.status)}</text>
  <path d="M${BUS_X} ${busTop}V${busBottom}" stroke="${chipStroke}" stroke-width="1.4" opacity="${dark ? 0.9 : 0.75}"/>
  <text x="${BUS_X}" y="${busTop - 12}" text-anchor="middle" class="serif" font-size="11" font-style="italic" fill="${t.muted}">pixels</text>
  <text x="${BUS_X}" y="${busBottom + 20}" text-anchor="middle" class="serif" font-size="11" font-style="italic" fill="${t.muted}">pins</text>
  ${pulses}
  ${chips.join("")}
  <text x="${CHIP.x}" y="${H - 28}" class="caps" font-size="9" fill="${t.muted}">Tools</text>
  <text x="${CHIP.x + 52}" y="${H - 28}" class="mono" font-size="10.5" fill="${t.ink}">${esc(TOOLS.join(" · "))}</text>
</svg>
`;
}

const now = await latestPush();
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "profile.svg"), card(THEMES.light, now));
await writeFile(join(outDir, "profile-dark.svg"), card(THEMES.dark, now));
console.log(JSON.stringify({ now }));
