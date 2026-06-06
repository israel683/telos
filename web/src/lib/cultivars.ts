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

/**
 * How this cultivar is harvested — the word "harvest" is cultivar-specific:
 *  - cut_and_come_again: repeated partial cuts; the plant keeps producing (basil, leaf herbs)
 *  - repeated_pick: pick produce as it ripens over a long window (tomato, pepper)
 *  - single_terminal: one final cut ends the grow (head lettuce, radicchio, mâche)
 */
export type CultivarHarvest = {
  mode: "cut_and_come_again" | "repeated_pick" | "single_terminal";
  /** Readiness trigger for the FIRST harvest, in plain grower language. */
  first_harvest: string;
  /** Days between recurring harvests once established; null for single_terminal. */
  cadence_days: number | null;
  /** Exactly what to do at each harvest — the execution instructions. */
  instructions: string;
  /** When the GROW itself ends / the plant should be retired; null = open-ended. */
  end_of_grow: string | null;
};

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
  /** Cultivar-specific harvest model. Inherited from the species when absent. */
  harvest?: CultivarHarvest;
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

/**
 * Harvest model for a cultivar, inheriting from the species when the cultivar
 * record doesn't define its own (so e.g. "Cuore di Bue" gets the tomato model).
 * Walks the leaf→root chain and returns the NEAREST harvest block.
 */
export function resolveCultivarHarvest(
  id: string | null | undefined
): CultivarHarvest | null {
  if (!id || !(id in CULTIVAR_REGISTRY)) return null;
  // inheritanceChain is root-first; reverse so we prefer the most specific.
  for (const node of inheritanceChain(id).reverse()) {
    if (node.harvest) return node.harvest;
  }
  return null;
}
