/**
 * Telos Brain — Claude decision engine (TS port of agent/brain.py).
 *
 * Flow:
 *  1. Build windowed-stats user prompt
 *  2. Send to Claude with cached SYSTEM_PROMPT (1h TTL beta)
 *  3. Parse JSON response
 *  4. Validate each proposed action via safety controller
 *  5. Dedupe proposed human tasks against currently-pending list
 *  6. Return structured decision (caller persists to DB and executes)
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { SYSTEM_PROMPT, buildUserPrompt, type SystemProfile } from "./prompt-engine";
import { validateCommand, type DoserChannel } from "./safety";
import type { BrainTier } from "./cycle-gate";
import { DEFAULT_SYSTEM_ID, type WaterReading, type HumanTask, type TaskType, type TaskPriority } from "./db";
import { allChannelKeys, getDosingConfig, type DosingConfig } from "./dosing-config";
import { getProfile } from "./fertilizer-profiles";
import { getPrimingState, type PrimingState } from "./priming";
import { getBottleStatusReport } from "./bottle-status";
import { getSystem, getGrowerMemory, getRecentEpisodes } from "./db";
import { getEffectiveTargets, diurnalContext } from "./tolerance";
import { getCultivarRecord } from "./cultivars";
import type { HarvestPlan } from "./grow-profile";

const CACHE_TTL_BETA = "extended-cache-ttl-2025-04-11";

const anthropic = createAnthropic({
  apiKey: process.env.GROWK_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY,
  baseURL: "https://api.anthropic.com/v1",
});

export type ApprovedCommand = {
  channel: DoserChannel;
  amount_ml: number;
  reason: string;
};

export type BlockedCommand = {
  command: string;
  reason: string;
};

export type ProposedTask = {
  type: TaskType;
  priority: TaskPriority;
  title: string;
  reason: string;
  payload: Record<string, unknown>;
  expires_in_hours: number | null;
};

export type DecisionResult = {
  commands: ApprovedCommand[];
  blocked_commands: BlockedCommand[];
  /**
   * Every dose the Brain proposed this cycle (structurally valid channel +
   * amount), INDEPENDENT of whether safety approved it. Used to surface a
   * recommendation to the grower even when the autonomous safety caps blocked
   * it — under manual dosing the grower executes by hand, so a capped proposal
   * must still become a dose_approval task, not vanish.
   */
  proposed_doses: ApprovedCommand[];
  human_tasks: ProposedTask[];
  analysis: string;
  message: string;
  status: "healthy" | "attention" | "warning" | "critical" | "unknown";
  concerns: string[];
  next_check_minutes: number;
  /** Optional harvest-plan update the Brain emitted this cycle (persisted into grow_profile). null = no change. */
  harvest_plan: HarvestPlan | null;
  /** Which model tier actually reasoned this pass (light routine / heavy refinement). */
  tier: BrainTier;
  raw_response: Record<string, unknown>;
  tokens_input: number;
  tokens_output: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
};

const VALID_TASK_TYPES = new Set<TaskType>([
  "water_change",
  "dose_approval",
  "system_reset",
  "question",
  "manual_action",
]);
const VALID_PRIORITIES = new Set<TaskPriority>(["low", "medium", "high", "urgent"]);

export async function analyzeAndDecide(opts: {
  current: WaterReading;
  recent: WaterReading[];
  systemProfile: SystemProfile;
  recentActions: Array<{ ts: Date; channel: string; amount_ml: number; success: boolean; reason: string }>;
  pendingTasks: HumanTask[];
  /** Per-system dosing config. Optional for backward-compat — looked up if absent. */
  dosingConfig?: DosingConfig;
  /** System id whose history we're reasoning about. Used for safety + DB scoping. */
  systemId?: string;
  /**
   * Which model tier to reason with. `light` = the routine proactive review on a
   * cheap/fast model; `heavy` = the smart model for excursions, conflicts, and the
   * refinement round. Defaults to `heavy` (the conservative choice when unset).
   */
  tier?: BrainTier;
}): Promise<DecisionResult> {
  const systemId = opts.systemId ?? DEFAULT_SYSTEM_ID;
  const tier: BrainTier = opts.tier ?? "heavy";
  const dosingConfig = opts.dosingConfig ?? (await getDosingConfig(systemId));
  const channels = allChannelKeys(dosingConfig);
  const fertilizerProfile = getProfile(dosingConfig.profile_id);
  // Priming state is derived from the dosing_actions log — small DB read,
  // worth the trip so Claude knows which channels still need their first
  // ~8ml prime before any dose-vs-EC reasoning is meaningful.
  const primingState: PrimingState = await getPrimingState(systemId);
  // Bottle status with predictions — feeds the per-channel days-until-empty
  // so the brain can proactively flag refills + reason about whether a
  // proposed dose has enough liquid to actually run.
  const bottleReport = await getBottleStatusReport(systemId);
  // Tolerance bands + diurnal context — without these the brain would
  // chase every small pH wobble.  With them it understands the dead-band:
  // "within the comfortable zone, even if not exactly at target, is fine."
  const sysRow = await getSystem(systemId);
  const targets = sysRow ? getEffectiveTargets(sysRow) : undefined;
  const diurnal = diurnalContext();
  // Grower Memory — what the grower has taught the Brain about this grow.
  const growerMemory = await getGrowerMemory(systemId);
  // Episodic memory — the Brain's own recent-cycle narrative log.
  const episodes = await getRecentEpisodes(systemId);

  const userPrompt = buildUserPrompt({
    current: opts.current,
    recent: opts.recent,
    systemProfile: opts.systemProfile,
    recentActions: opts.recentActions,
    availableChannels: channels,
    dosingConfig,
    fertilizerProfile,
    primingState,
    bottleReport,
    targets,
    diurnal,
    growProfile: sysRow?.grow_profile ?? null,
    growerMemory,
    episodes,
    cultivar: getCultivarRecord(sysRow?.cultivar_id ?? sysRow?.crop_type ?? opts.systemProfile.crop_type),
    pendingTasks: opts.pendingTasks.map((t) => ({
      id: t.id,
      type: t.type,
      priority: t.priority,
      title: t.title,
      created_at: t.created_at,
    })),
  });

  // Tiered model selection (config-driven so tiers move without a code change).
  //  - heavy: the smart model — excursions, conflicts, the refinement round.
  //  - light: a cheap/fast model for the routine in-band proactive review.
  // CHAT_MODEL stays the heavy override for backward-compat with existing deploys.
  const HEAVY_MODEL = process.env.BRAIN_MODEL_HEAVY || process.env.CHAT_MODEL || "claude-sonnet-4-6";
  const LIGHT_MODEL = process.env.BRAIN_MODEL_LIGHT || "claude-haiku-4-5-20251001";
  const modelId = tier === "light" ? LIGHT_MODEL : HEAVY_MODEL;
  const existingTaskTypes = new Set(opts.pendingTasks.map((t) => t.type));

  let result;
  try {
    result = await generateText({
      model: anthropic(modelId),
      maxOutputTokens: 2048,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
          },
        },
        { role: "user", content: userPrompt },
      ],
      headers: { "anthropic-beta": CACHE_TTL_BETA },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[brain] Claude error:", msg);
    return fallback(`API error: ${msg}`, tier);
  }

  const text = result.text;
  let aiDecision: Record<string, unknown>;
  try {
    aiDecision = parseJsonResponse(text);
  } catch (e) {
    return fallback(`JSON parse: ${e instanceof Error ? e.message : String(e)}`, tier);
  }

  const approved: ApprovedCommand[] = [];
  const blocked: BlockedCommand[] = [];
  const proposedDoses: ApprovedCommand[] = [];

  const actions = Array.isArray(aiDecision.actions) ? aiDecision.actions : [];
  for (const a of actions) {
    const action = a as Record<string, unknown>;
    const channelStr = String(action.channel || "");
    const amountMl = Number(action.amount_ml);
    if (!channels.includes(channelStr)) {
      blocked.push({
        command: `${channelStr} ${amountMl}ml`,
        reason: `Unknown channel '${channelStr}' (configured: ${channels.join(", ") || "(none)"})`,
      });
      continue;
    }
    if (!Number.isFinite(amountMl)) {
      blocked.push({
        command: `${channelStr}`,
        reason: `Invalid amount_ml: ${String(action.amount_ml)}`,
      });
      continue;
    }
    const cmd = {
      channel: channelStr as DoserChannel,
      amount_ml: amountMl,
      reason: String(action.reason || "AI recommended"),
    };
    // Record the proposal regardless of safety — so a needed-but-capped dose
    // still reaches the grower as a recommendation under manual dosing.
    proposedDoses.push(cmd);
    const v = await validateCommand(cmd, opts.current, { systemId, dosingConfig });
    if (v.ok) approved.push(cmd);
    else blocked.push({ command: `Dose ${cmd.amount_ml}ml of ${cmd.channel}`, reason: v.reason });
  }

  const proposed = Array.isArray(aiDecision.human_tasks_to_create)
    ? aiDecision.human_tasks_to_create
    : [];
  const tasks: ProposedTask[] = [];
  for (const t of proposed) {
    const task = t as Record<string, unknown>;
    const type = String(task.type || "");
    if (!VALID_TASK_TYPES.has(type as TaskType)) continue;
    // Dedup against what's already pending RIGHT NOW (in-memory, no DB round-trip)
    // AND against same-type duplicates within this one response (existingTaskTypes
    // is seeded from pendingTasks and grown below). The recent-window dedup
    // (resolved-within-N-hours) is owned SOLELY by the cron's create loop
    // (lib/cycle.ts → TASK_DEDUP_HOURS), which is the authoritative gate right
    // before insertion — running it here too was a redundant per-task DB query
    // with a conflicting window.
    if (existingTaskTypes.has(type as TaskType)) continue;
    const priority = String(task.priority || "medium");
    tasks.push({
      type: type as TaskType,
      priority: (VALID_PRIORITIES.has(priority as TaskPriority) ? priority : "medium") as TaskPriority,
      title: String(task.title || type),
      reason: String(task.reason || ""),
      payload: (task.payload as Record<string, unknown>) || {},
      expires_in_hours:
        typeof task.expires_in_hours === "number" ? task.expires_in_hours : null,
    });
    existingTaskTypes.add(type as TaskType);
  }

  const u = result.usage as unknown as {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };

  return {
    commands: approved,
    blocked_commands: blocked,
    proposed_doses: proposedDoses,
    human_tasks: tasks,
    analysis: String(aiDecision.analysis || ""),
    message: String(aiDecision.message_to_grower || ""),
    status: (["healthy", "attention", "warning", "critical"] as const).includes(
      aiDecision.status as "healthy" | "attention" | "warning" | "critical"
    )
      ? (aiDecision.status as "healthy" | "attention" | "warning" | "critical")
      : "unknown",
    concerns: Array.isArray(aiDecision.concerns) ? (aiDecision.concerns as string[]) : [],
    next_check_minutes: Number(aiDecision.next_check_minutes) || 60,
    harvest_plan: parseHarvestPlan(aiDecision.harvest_plan),
    tier,
    raw_response: aiDecision,
    tokens_input: u.inputTokens || 0,
    tokens_output: u.outputTokens || 0,
    cache_creation_tokens: u.cacheCreationInputTokens || 0,
    cache_read_tokens: u.cacheReadInputTokens || u.cachedInputTokens || 0,
  };
}

function parseJsonResponse(text: string): Record<string, unknown> {
  let t = text.trim();
  if (t.startsWith("```")) {
    const firstNewline = t.indexOf("\n");
    if (firstNewline !== -1) t = t.slice(firstNewline + 1);
    else t = t.slice(3);
    const lastFence = t.lastIndexOf("```");
    if (lastFence !== -1) t = t.slice(0, lastFence);
  }
  return JSON.parse(t);
}

/**
 * Validate the Brain's optional `harvest_plan` output. Returns a clean
 * HarvestPlan to persist, or null when absent/malformed (so the stored plan is
 * left unchanged). Defensive: the Brain controls this field via free JSON.
 */
function parseHarvestPlan(raw: unknown): HarvestPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const modes = ["cut_and_come_again", "repeated_pick", "single_terminal"];
  const mode = typeof r.mode === "string" && modes.includes(r.mode) ? r.mode : null;
  const instructions = typeof r.instructions === "string" ? r.instructions.trim() : "";
  if (!mode || !instructions) return null; // not a usable plan
  // next_date: accept an ISO YYYY-MM-DD (or null).
  let next_date: string | null = null;
  if (typeof r.next_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.next_date.trim())) {
    next_date = r.next_date.trim();
  }
  const prep = Number(r.prep_lead_days);
  return {
    mode,
    next_date,
    prep_lead_days: Number.isFinite(prep) ? Math.max(0, Math.min(14, Math.round(prep))) : 1,
    instructions,
    note: typeof r.note === "string" ? r.note.trim() : null,
    updated_at: new Date().toISOString(),
  };
}

function fallback(reason: string, tier: BrainTier = "heavy"): DecisionResult {
  return {
    commands: [],
    blocked_commands: [],
    proposed_doses: [],
    human_tasks: [],
    analysis: `AI unavailable: ${reason}. Maintaining current state.`,
    message: "המערכת עובדת במצב שמרני — ה-AI לא זמין כרגע",
    status: "attention",
    concerns: [reason],
    next_check_minutes: 5,
    harvest_plan: null,
    tier,
    raw_response: { error: reason },
    tokens_input: 0,
    tokens_output: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
  };
}
