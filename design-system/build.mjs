// TELOS design-tokens generator — the single source of truth is tokens.json.
// Edit tokens.json, then run `npm run sync:design` (from Code/web). This emits
// every consumer artifact so one edit propagates everywhere. Never hand-edit a
// generated file.
//
// Consumers produced:
//   web/src/brand/tokens.generated.ts   — typed tokens for app code (tokens.ts re-exports)
//   web/src/app/globals.css              — :root CSS vars (only between the DESIGN-TOKENS markers)
//   design-system/tokens.css             — portable standalone CSS (incl. font families)
//   design-system/tokens.flat.json       — flat name→value map for Figma / external tools
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const T = JSON.parse(readFileSync(join(here, "tokens.json"), "utf8"));

const WEB = join(here, "..", "web");
const banner = (how) =>
  `/* GENERATED from design-system/tokens.json — do not edit by hand.\n   Regenerate: npm run sync:design (${how}). */\n`;

// --- resolve a "group.key" semantic reference to its raw value ---
function resolveRef(ref) {
  const [group, key] = ref.split(".");
  const v = T.color?.[group]?.[key];
  if (v === undefined) throw new Error(`unresolved color ref: ${ref}`);
  return v;
}
// resolve a semantic ref to the CSS var of its target (e.g. accent.basil -> var(--c-basil))
function resolveRefToVar(ref) {
  const [, key] = ref.split(".");
  return `var(--c-${key})`;
}

const foundation = T.color.foundation;
const accent = T.color.accent;
const semantic = T.color.semantic;

// ─────────────────────────────────────────────────────────────────────────
// 1) TypeScript — tokens.generated.ts (exact shapes the app already imports)
// ─────────────────────────────────────────────────────────────────────────
const semanticResolved = Object.fromEntries(
  Object.entries(semantic).map(([k, v]) => [k, resolveRef(v)])
);
const ts =
  banner("TS") +
  `\n` +
  `export const FOUNDATION = ${JSON.stringify(foundation, null, 2)} as const;\n\n` +
  `export const ACCENT = ${JSON.stringify(accent, null, 2)} as const;\n\n` +
  `export const SEMANTIC = ${JSON.stringify(semanticResolved, null, 2)} as const;\n\n` +
  `export const TYPE = ${JSON.stringify(
    {
      display_en: T.font.display_en,
      body_en: T.font.body_en,
      display_he: T.font.display_he,
      body_he: T.font.body_he,
      numbers: T.font.numbers,
      sizes: T.fontSize,
      tracking: T.tracking,
    },
    null,
    2
  )} as const;\n\n` +
  `export const SPACE = ${JSON.stringify(T.space, null, 2)} as const;\n\n` +
  `export const RADIUS = ${JSON.stringify(T.radius, null, 2)} as const;\n\n` +
  `export const BORDER = ${JSON.stringify(T.border, null, 2)} as const;\n\n` +
  `export const MOTION = ${JSON.stringify(T.motion, null, 2)} as const;\n\n` +
  `export const TAGLINES = ${JSON.stringify(T.taglines, null, 2)} as const;\n\n` +
  `export const LIGHT = ${JSON.stringify(T.lightLayer, null, 2)} as const;\n\n` +
  `export const ROLE = ${JSON.stringify(T.role, null, 2)} as const;\n\n` +
  `export const ATMOSPHERE = ${JSON.stringify(T.atmosphere, null, 2)} as const;\n`;
writeFileSync(join(WEB, "src", "brand", "tokens.generated.ts"), ts, "utf8");

// ─────────────────────────────────────────────────────────────────────────
// 2) CSS :root variable block (shared by globals.css inject + portable file)
// ─────────────────────────────────────────────────────────────────────────
function cssVarLines() {
  const L = [];
  L.push("  /* Foundation — Warm Neutral dark system */");
  for (const [k, v] of Object.entries(foundation)) L.push(`  --c-${k}: ${v};`);
  L.push("");
  L.push("  /* Accents — used sparingly */");
  for (const [k, v] of Object.entries(accent)) L.push(`  --c-${k}: ${v};`);
  L.push("");
  L.push("  /* Semantic aliases */");
  for (const k of T.color.cssSemanticAliases) L.push(`  --c-${k}: ${resolveRefToVar(semantic[k])};`);
  L.push("");
  L.push("  /* Type scale */");
  for (const [k, v] of Object.entries(T.fontSize)) L.push(`  --t-${k}: ${v};`);
  L.push("");
  L.push("  /* Tracking */");
  for (const [k, v] of Object.entries(T.tracking)) L.push(`  --ls-${k}: ${v};`);
  L.push("");
  L.push("  /* Radii */");
  for (const [k, v] of Object.entries(T.radius)) L.push(`  --r-${k}: ${v};`);
  L.push("");
  L.push("  /* Borders */");
  for (const [k, v] of Object.entries(T.border)) L.push(`  --border-${k}: ${v};`);
  L.push("");
  L.push("  /* Motion */");
  L.push(`  --ease-out: ${T.motion.easing.out};`);
  L.push(`  --ease-in: ${T.motion.easing.in};`);
  for (const [k, v] of Object.entries(T.motion.duration)) L.push(`  --dur-${k}: ${v}ms;`);
  L.push("");
  L.push("  /* Light Layer — warmth is light, not surface (key = exact CSS var) */");
  for (const [k, v] of Object.entries(T.lightLayer)) L.push(`  --${k}: ${v};`);
  L.push("");
  L.push("  /* Semantic role tokens — switch-ready Dark→Light */");
  for (const [k, v] of Object.entries(T.role)) L.push(`  --${k}: ${v};`);
  L.push("");
  L.push("  /* Atmosphere + hero motion */");
  for (const [k, v] of Object.entries(T.atmosphere)) L.push(`  --${k}: ${v};`);
  return L.join("\n");
}
const rootBlock = cssVarLines();

// 2a) inject into globals.css between the markers (leave everything else intact)
const GLOBALS = join(WEB, "src", "app", "globals.css");
const START = "/* DESIGN-TOKENS:START";
const END = "/* DESIGN-TOKENS:END */";
let css = readFileSync(GLOBALS, "utf8");
const startIdx = css.indexOf(START);
const endIdx = css.indexOf(END);
if (startIdx === -1 || endIdx === -1) {
  throw new Error(
    "globals.css is missing the DESIGN-TOKENS:START / END markers — add them around the generated :root block first."
  );
}
const startLineEnd = css.indexOf("\n", startIdx) + 1;
const generatedRoot =
  `:root {\n${rootBlock}\n}\n`;
css = css.slice(0, startLineEnd) + generatedRoot + css.slice(endIdx);
writeFileSync(GLOBALS, css, "utf8");

// 2b) portable standalone CSS (includes literal font families for non-next/font consumers)
const fontLines = [
  `  --f-display: ${T.font.display_en};`,
  `  --f-body: ${T.font.body_en};`,
  `  --f-display-he: ${T.font.display_he};`,
  `  --f-body-he: ${T.font.body_he};`,
  `  --f-numbers: ${T.font.numbers};`,
].join("\n");
writeFileSync(
  join(here, "tokens.css"),
  `/* ${T.$meta.name} v${T.$meta.version} — ${banner("CSS").trim()}\n   Portable token CSS for any consumer. The web app wires fonts via next/font in globals.css. */\n:root {\n  /* Fonts */\n${fontLines}\n\n${rootBlock}\n}\n`,
  "utf8"
);

// ─────────────────────────────────────────────────────────────────────────
// 3) Flat JSON — name → value, for Figma plugins / Style Dictionary / other apps
// ─────────────────────────────────────────────────────────────────────────
const flat = {};
for (const [k, v] of Object.entries(foundation)) flat[`color.${k}`] = v;
for (const [k, v] of Object.entries(accent)) flat[`color.${k}`] = v;
for (const [k, v] of Object.entries(semantic)) flat[`color.semantic.${k}`] = resolveRef(v);
flat["font.display_en"] = T.font.display_en;
flat["font.body_en"] = T.font.body_en;
flat["font.display_he"] = T.font.display_he;
flat["font.body_he"] = T.font.body_he;
flat["font.numbers"] = T.font.numbers;
for (const [k, v] of Object.entries(T.fontSize)) flat[`fontSize.${k}`] = v;
for (const [k, v] of Object.entries(T.tracking)) flat[`tracking.${k}`] = v;
for (const [k, v] of Object.entries(T.space)) flat[`space.${k}`] = v;
for (const [k, v] of Object.entries(T.radius)) flat[`radius.${k}`] = v;
for (const [k, v] of Object.entries(T.border)) flat[`border.${k}`] = v;
flat["motion.easing.out"] = T.motion.easing.out;
flat["motion.easing.in"] = T.motion.easing.in;
for (const [k, v] of Object.entries(T.motion.duration)) flat[`motion.duration.${k}`] = v;
for (const [k, v] of Object.entries(T.lightLayer)) flat[`light.${k}`] = v;
for (const [k, v] of Object.entries(T.role)) flat[`role.${k}`] = v;
for (const [k, v] of Object.entries(T.atmosphere)) flat[`atmosphere.${k}`] = v;
flat["taglines.primary"] = T.taglines.primary;
flat["taglines.secondary"] = T.taglines.secondary;
writeFileSync(join(here, "tokens.flat.json"), JSON.stringify(flat, null, 2) + "\n", "utf8");

console.log(
  `[sync:design] wrote tokens.generated.ts, injected globals.css :root, wrote tokens.css + tokens.flat.json (${Object.keys(flat).length} flat entries).`
);
