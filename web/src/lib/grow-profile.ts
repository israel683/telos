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
  /**
   * The Brain's planned-ahead OPTIMAL HARVEST for this grow. The Brain maintains
   * it (sets/rolls the next date from the cultivar's harvest model + stage), the
   * /grow screen shows it, and the Brain opens a prep heads-up + an execution
   * task around `next_date`. For cut-and-come-again crops it rolls forward by the
   * cultivar cadence after each harvest; for single_terminal it's the one date.
   */
  harvest_plan?: HarvestPlan | null;
};

export type HarvestPlan = {
  /** Cultivar harvest mode (cut_and_come_again | repeated_pick | single_terminal). */
  mode: string;
  /** ISO date (YYYY-MM-DD) of the next planned harvest/cut, or null if not yet set. */
  next_date: string | null;
  /** Days before next_date to surface the prep heads-up task. */
  prep_lead_days: number;
  /** Exactly what to do at this harvest (cultivar + stage specific). */
  instructions: string;
  /** Short why-now / target note (Hebrew, grower-facing). */
  note?: string | null;
  /** ISO timestamp the Brain last updated the plan. */
  updated_at?: string | null;
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

/**
 * Apply a single grower-supplied answer (by catalog question id) into a profile.
 * Coerces by the question's declared type and follows the SAME merge rules as
 * the Brain's `recordGrowProfile` tool: `water_baseline` merges by key, and
 * `practices` appends + dedupes. Returns the next profile (does not mutate the
 * input). Throws on an unknown id, an empty answer, or a non-numeric answer to
 * a number question.
 *
 * This is what lets the grower self-answer onboarding questions straight from
 * the Grow screen when they never went through (or skipped) the chat kickoff —
 * writing to the same `grow_profile` store the Brain reads.
 */
export function applyOnboardingAnswer(
  profile: GrowProfile | null | undefined,
  questionId: string,
  rawValue: string
): GrowProfile {
  const q = ONBOARDING_CATALOG.find((x) => x.id === questionId);
  if (!q) throw new Error(`unknown onboarding question: ${questionId}`);
  const value = rawValue.trim();
  if (!value) throw new Error("answer is empty");

  const next: GrowProfile = { ...(profile ?? {}) };

  // practices: append to the list, never replace.
  if (q.field === "practices") {
    next.practices = Array.from(new Set([...(next.practices ?? []), value]));
    return next;
  }

  if (q.type === "number") {
    const num = Number(value);
    if (!Number.isFinite(num)) throw new Error("expected a number");
    // Nested baseline path (water_baseline.ph / water_baseline.ec) merges by key.
    const [root, key] = q.field.split(".");
    if (key && root === "water_baseline") {
      next.water_baseline = { ...(next.water_baseline ?? {}), [key]: num };
      return next;
    }
    (next as Record<string, unknown>)[q.field] = num;
    return next;
  }

  // text / choice → a top-level string field.
  (next as Record<string, unknown>)[q.field] = value;
  return next;
}

/** One catalog question paired with its CURRENT stored value — for the editable Grow Context UI. */
export type GrowContextField = {
  id: string;
  question: string;
  type: OnboardingQuestionType;
  choices: string[] | null;
  required: boolean;
  answered: boolean;
  /** Human-readable current value (joined for arrays), or null if unanswered. */
  value: string | null;
};

/** Full catalog with each question's current stored value — lets the UI both complete AND revise answers. */
export function growContextView(profile: GrowProfile | null | undefined): GrowContextField[] {
  const p = (profile ?? {}) as Record<string, unknown>;
  return ONBOARDING_CATALOG.map((q) => {
    const raw = getPath(p, q.field);
    const answered = isAnswered(raw);
    let value: string | null = null;
    if (answered) value = Array.isArray(raw) ? raw.join(", ") : String(raw);
    return {
      id: q.id,
      question: q.q,
      type: q.type,
      choices: q.choices ?? null,
      required: q.required ?? false,
      answered,
      value,
    };
  });
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
