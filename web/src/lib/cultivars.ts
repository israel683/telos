/**
 * Cultivar Registry (TypeScript side) — the Network Knowledge layer, read by the
 * dashboard and the Vercel cron Brain. Mirrors the Python registry in
 * growk/data/cultivars.py; both consume the SAME JSON source of truth in
 * growk/cultivars/ (synced here via `npm run sync:cultivars` into the committed
 * cultivars.generated.ts). See ../../NEXTGEN-ARCHITECTURE.md §1.
 *
 * The brand sells *cultivar* (Basilico Genovese DOP), not *crop* (basil). This is
 * where the dashboard's "knowing" lives, and it must agree with the Brain.
 */
import type { MetricTarget, TargetRanges } from "./tolerance";
import { CULTIVAR_REGISTRY } from "./cultivars.generated";

/** Per-stage target bands — same MetricTarget shape as tolerance.ts. */
export type CultivarStageBands = Partial<
  Record<"ph" | "ec" | "water_temp", MetricTarget>
>;

export type CultivarRecord = {
  id: string;
  species: string;
  cultivar: string | null;
  provenance: string | null;
  protocol_version: number;
  /** Species id to inherit stage bands from; null for a species (root) record. */
  inherits: string | null;
  stages: Partial<Record<string, CultivarStageBands>>;
  stress_signatures?: string[];
  harvest_markers?: string[];
  story?: { he: string | null; en: string | null };
};

const STAGES = ["seedling", "vegetative", "flowering", "fruiting"] as const;
const DEFAULT_STAGE = "vegetative";

export function getCultivarRecord(
  id: string | null | undefined
): CultivarRecord | null {
  if (!id) return null;
  return CULTIVAR_REGISTRY[id] ?? null;
}

export function allCultivarIds(): string[] {
  return Object.keys(CULTIVAR_REGISTRY).sort();
}

/** Inheritance chain, root species first, leaf cultivar last. Cycle-safe. */
function inheritanceChain(id: string): CultivarRecord[] {
  const chain: CultivarRecord[] = [];
  const seen = new Set<string>();
  let cur: CultivarRecord | null = CULTIVAR_REGISTRY[id] ?? null;
  while (cur && !seen.has(cur.id)) {
    chain.push(cur);
    seen.add(cur.id);
    cur = cur.inherits ? CULTIVAR_REGISTRY[cur.inherits] ?? null : null;
  }
  return chain.reverse();
}

/** Merged stage bands following the inherits chain. Null if id unknown. */
export function resolveCultivarStage(
  id: string | null | undefined,
  stage: string | null | undefined
): CultivarStageBands | null {
  if (!id || !(id in CULTIVAR_REGISTRY)) return null;
  const st = (STAGES as readonly string[]).includes(stage ?? "")
    ? (stage as string)
    : DEFAULT_STAGE;
  const merged: CultivarStageBands = {};
  for (const node of inheritanceChain(id)) {
    const ns = node.stages?.[st];
    if (ns) Object.assign(merged, ns);
  }
  return Object.keys(merged).length ? merged : null;
}

/**
 * Cultivar-resolved target ranges in the tolerance.ts shape, or null if the id
 * is not a known cultivar/species. The band shape is identical, so this is a
 * direct projection.
 */
export function cultivarTargets(
  id: string | null | undefined,
  stage: string | null | undefined
): TargetRanges | null {
  const bands = resolveCultivarStage(id, stage);
  if (!bands) return null;
  return { ph: bands.ph, ec: bands.ec, water_temp: bands.water_temp };
}
