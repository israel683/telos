// Sync the cultivar registry from the canonical source (growk/cultivars/*.json)
// into a committed TypeScript module the Next bundle can import without any
// runtime filesystem access.
//
// The Python Brain (growk) and this dashboard are two separate deployments with
// two separate databases, so the JSON files are the SHARED source of truth.
// growk reads them directly; here we generate src/lib/cultivars.generated.ts.
//
// Run after editing any protocol:  npm run sync:cultivars
// (The generated file is committed, so a Vercel build that has no access to
//  ../../growk uses the checked-in copy unchanged.)
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "..", "growk", "cultivars");
const OUT = join(here, "..", "src", "lib", "cultivars.generated.ts");

if (!existsSync(SRC)) {
  console.log(`[sync-cultivars] source ${SRC} not found — keeping existing generated file.`);
  process.exit(0);
}

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (entry.name.endsWith(".json")) out.push(full);
  }
  return out;
}

const registry = {};
for (const file of collect(SRC).sort()) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (data && typeof data.id === "string" && data.id) registry[data.id] = data;
}

const ids = Object.keys(registry).sort();
const body = JSON.stringify(
  Object.fromEntries(ids.map((id) => [id, registry[id]])),
  null,
  2
);

const banner =
  "// GENERATED FILE — do not edit by hand.\n" +
  "// Source of truth: growk/cultivars/*.json\n" +
  "// Regenerate with: npm run sync:cultivars\n";

writeFileSync(
  OUT,
  `${banner}import type { CultivarRecord } from "./cultivars";\n\n` +
    `export const CULTIVAR_REGISTRY: Record<string, CultivarRecord> = ${body};\n`,
  "utf8"
);

console.log(`[sync-cultivars] wrote ${ids.length} records → ${OUT}`);
console.log(`[sync-cultivars] ids: ${ids.join(", ")}`);
