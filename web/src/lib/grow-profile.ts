/**
 * Grow Profile — the "personal Brain of this grow" (Grow Context layer,
 * NEXTGEN-ARCHITECTURE.md §1). Built from the onboarding questions and stored
 * as a typed JSONB blob on systems.grow_profile (Neon — the production DB the
 * Vercel cron Brain reads). This is per-grow state, so it lives in the database,
 * not in a repo file like the cultivar registry.
 *
 * The brand's discovery doctrine: ask the grower many questions, then build the
 * personal Brain of their grow. This catalog is that question set, in Telos voice.
 */

/** The personal context of one grow, beyond what the systems columns hold. */
export type GrowProfile = {
  /** Source water before any nutrient is added — RO, tap, well, rainwater. */
  water_source?: string;
  /** Baseline of the source water (pre-nutrient) so the Brain reasons from zero. */
  water_baseline?: { ph?: number; ec?: number };
  /** Light regime — full sun outdoors, or LED type + hours. */
  light?: string;
  /** Local climate / exposure in the grower's words (later enriched by a weather feed). */
  climate?: string;
  /** What this grow is FOR — the cultivar, the buyer, the harvest target. */
  business_goal?: string;
  /** The premium buyer this grow serves (a chef, a restaurant). */
  target_buyer?: string;
  /** Things the grower does routinely that the Brain must account for. */
  practices?: string[];
  /** ISO timestamp when onboarding was marked complete; null/absent = in progress. */
  onboarding_completed_at?: string | null;
};

export type OnboardingQuestionType = "text" | "number" | "choice";

export type OnboardingQuestion = {
  /** Stable id; also the analytics key. */
  id: string;
  /** Dot-path into GrowProfile this answer fills. */
  field: string;
  /** Grower-facing question, in Hebrew, in Telos voice. */
  q: string;
  type: OnboardingQuestionType;
  choices?: string[];
  /** A grow can't be fully understood without these; the Brain keeps asking. */
  required?: boolean;
};

/**
 * The onboarding catalog — versioned with the code. Bump CATALOG_VERSION on any
 * change so a stored profile can be re-checked against new questions.
 */
export const ONBOARDING_CATALOG_VERSION = 1;

export const ONBOARDING_CATALOG: OnboardingQuestion[] = [
  {
    id: "water_source",
    field: "water_source",
    q: "מאיפה המים שלך מגיעים — ברז, אוסמוזה הפוכה, באר, או מי גשם?",
    type: "choice",
    choices: ["מי ברז", "אוסמוזה הפוכה", "באר", "מי גשם"],
    required: true,
  },
  {
    id: "water_baseline_ec",
    field: "water_baseline.ec",
    q: "מה ה‑EC של המים לפני שאתה מוסיף דשן? (אם לא מדדת — נמדוד יחד)",
    type: "number",
    required: true,
  },
  {
    id: "light",
    field: "light",
    q: "מה מקור האור — שמש מלאה בחוץ, או תאורה? אם תאורה, איזו וכמה שעות ביום?",
    type: "text",
    required: true,
  },
  {
    id: "climate",
    field: "climate",
    q: "איך היית מתאר את האקלים והחשיפה במקום? (חום קיצי, רוח, צל בשעות מסוימות)",
    type: "text",
  },
  {
    id: "business_goal",
    field: "business_goal",
    q: "מה היעד של הגידול הזה — איזה זן, ולאיזה תאריך קציר אתה מכוון?",
    type: "text",
    required: true,
  },
  {
    id: "target_buyer",
    field: "target_buyer",
    q: "למי הגידול מיועד — יש שף או מסעדה ספציפית שאתה רוצה להגיע אליהם?",
    type: "text",
  },
  {
    id: "practices",
    field: "practices",
    q: "יש משהו קבוע שאתה עושה לגידול ושכדאי שהמוח יכיר? (מילוי מי ברז בימי ראשון, קציר שבועי, וכו')",
    type: "text",
  },
];

function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function isAnswered(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Onboarding questions still unanswered for this profile, in catalog order. */
export function unansweredQuestions(
  profile: GrowProfile | null | undefined
): OnboardingQuestion[] {
  const p = (profile ?? {}) as Record<string, unknown>;
  return ONBOARDING_CATALOG.filter((q) => !isAnswered(getPath(p, q.field)));
}

/** True once every required question is answered (or onboarding was marked done). */
export function isOnboardingComplete(
  profile: GrowProfile | null | undefined
): boolean {
  if (profile?.onboarding_completed_at) return true;
  const p = (profile ?? {}) as Record<string, unknown>;
  return ONBOARDING_CATALOG.filter((q) => q.required).every((q) =>
    isAnswered(getPath(p, q.field))
  );
}

/**
 * Render the Grow Context as a prompt section. Includes what's known and, when
 * onboarding is incomplete, what's still missing — so the Brain knows to ask
 * (via the existing `question` Human Task) rather than guess.
 */
export function renderGrowContext(profile: GrowProfile | null | undefined): string {
  const p = profile ?? {};
  const lines: string[] = ["## Grow Context — the personal Brain of this grow"];

  const known: string[] = [];
  if (p.water_source) known.push(`  Water source: ${p.water_source}`);
  if (p.water_baseline && (p.water_baseline.ph != null || p.water_baseline.ec != null)) {
    const parts: string[] = [];
    if (p.water_baseline.ph != null) parts.push(`pH ${p.water_baseline.ph}`);
    if (p.water_baseline.ec != null) parts.push(`EC ${p.water_baseline.ec} μS/cm`);
    known.push(`  Source-water baseline (pre-nutrient): ${parts.join(", ")}`);
  }
  if (p.light) known.push(`  Light: ${p.light}`);
  if (p.climate) known.push(`  Climate / exposure: ${p.climate}`);
  if (p.business_goal) known.push(`  Goal: ${p.business_goal}`);
  if (p.target_buyer) known.push(`  Target buyer: ${p.target_buyer}`);
  if (p.practices && p.practices.length) {
    known.push("  Grower practices to account for:");
    for (const pr of p.practices) known.push(`    - ${pr}`);
  }

  if (known.length) lines.push(...known);
  else lines.push("  (not yet established — onboarding not started)");

  const missing = unansweredQuestions(p);
  if (missing.length) {
    lines.push(
      "  Onboarding incomplete — still unknown about this grow. Ask the grower " +
        "ONE of these at a time via a `question` Human Task (never guess these):"
    );
    for (const q of missing) lines.push(`    - ${q.q}`);
  }

  return lines.join("\n");
}
