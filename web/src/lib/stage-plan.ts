/**
 * Projected stage plan — the VIEW-LAYER estimate that lets the Grow Gantt
 * draw phase bands spanning the whole cycle before the Brain maintains a
 * stored per-grow timeline. These are typical hydroponic spans per species,
 * anchored at the grow's anchor date, and are ALWAYS labeled as projected
 * ("מוקרן") in the UI — they are honest estimates, not the Brain's plan.
 * When the Brain-owned `grow_profile.timeline` grows stage events (timeline
 * PR-2+), that becomes the source and this projection retires.
 */
import { getCultivarRecord } from "./cultivars";

export type StageSpan = {
  stage: "seedling" | "vegetative" | "flowering" | "fruiting" | "harvest_window";
  label: [string, string]; // [en, he]
  days: number;
  /** CSS color for the band segment. */
  tint: string;
};

const LEAFY: StageSpan[] = [
  { stage: "seedling", label: ["Seedling", "נבט"], days: 12, tint: "var(--c-mineral)" },
  { stage: "vegetative", label: ["Vegetative", "וגטטיבי"], days: 21, tint: "var(--c-basil)" },
  { stage: "harvest_window", label: ["Harvest window", "חלון קטיף"], days: 28, tint: "var(--amber)" },
];

const FRUITING: StageSpan[] = [
  { stage: "seedling", label: ["Seedling", "נבט"], days: 14, tint: "var(--c-mineral)" },
  { stage: "vegetative", label: ["Vegetative", "וגטטיבי"], days: 28, tint: "var(--c-basil)" },
  { stage: "flowering", label: ["Flowering", "פריחה"], days: 21, tint: "var(--c-terra)" },
  { stage: "fruiting", label: ["Fruiting", "פירות"], days: 42, tint: "var(--amber)" },
];

/** Species-specific overrides where the generic archetype is off. */
const BY_SPECIES: Record<string, StageSpan[]> = {
  basil: [
    { stage: "seedling", label: ["Seedling", "נבט"], days: 14, tint: "var(--c-mineral)" },
    { stage: "vegetative", label: ["Vegetative", "וגטטיבי"], days: 21, tint: "var(--c-basil)" },
    { stage: "harvest_window", label: ["Harvest window", "חלון קטיף"], days: 42, tint: "var(--amber)" },
  ],
  chicory: [
    { stage: "seedling", label: ["Seedling", "נבט"], days: 12, tint: "var(--c-mineral)" },
    { stage: "vegetative", label: ["Vegetative", "וגטטיבי"], days: 30, tint: "var(--c-basil)" },
    { stage: "harvest_window", label: ["Harvest window", "חלון קטיף"], days: 21, tint: "var(--amber)" },
  ],
  corn_salad: [
    { stage: "seedling", label: ["Seedling", "נבט"], days: 12, tint: "var(--c-mineral)" },
    { stage: "vegetative", label: ["Vegetative", "וגטטיבי"], days: 25, tint: "var(--c-basil)" },
    { stage: "harvest_window", label: ["Harvest window", "חלון קטיף"], days: 14, tint: "var(--amber)" },
  ],
  tomato: FRUITING,
  pepper: [
    { stage: "seedling", label: ["Seedling", "נבט"], days: 14, tint: "var(--c-mineral)" },
    { stage: "vegetative", label: ["Vegetative", "וגטטיבי"], days: 30, tint: "var(--c-basil)" },
    { stage: "flowering", label: ["Flowering", "פריחה"], days: 21, tint: "var(--c-terra)" },
    { stage: "fruiting", label: ["Fruiting", "פירות"], days: 45, tint: "var(--amber)" },
  ],
};

const FRUITING_CROPS = new Set(["tomato", "pepper", "strawberry", "cucumber"]);

/**
 * Resolve the projected stage plan for a grow. cultivar_id wins (its registry
 * species), then the free-form crop string (normalized). Unknown crops get the
 * leafy archetype — the safe default for the systems TELOS targets.
 */
export function projectStagePlan(
  cropType: string | null | undefined,
  cultivarId?: string | null
): StageSpan[] {
  const species =
    getCultivarRecord(cultivarId)?.species ??
    (cropType ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (BY_SPECIES[species]) return BY_SPECIES[species];
  // Free-text crops like "mixed: lettuce, tomato" — first match wins.
  for (const key of Object.keys(BY_SPECIES)) {
    if (species.includes(key)) return BY_SPECIES[key];
  }
  return FRUITING_CROPS.has(species) ? FRUITING : LEAFY;
}
