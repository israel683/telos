/**
 * GrowK Brain — Claude decision engine (TS port of agent/brain.py).
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
import type { WaterReading, HumanTask, TaskType, TaskPriority } from "./db";

const CACHE_TTL_BETA = "extended-cache-ttl-2025-04-11";

const anthropic = createAnthropic({
  apiKey: process.env.GROWK_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY,
  baseURL: "https://api.anthropic.com/v1",
});

const CHANNELS: DoserChannel[] = [
  "nutrient_a",
  "nutrient_b",
  "ph_up",
  "ph_down",
  "supplement",
];

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
  human_tasks: ProposedTask[];
  analysis: string;
  message: string;
  status: "healthy" | "attention" | "warning" | "critical" | "unknown";
  concerns: string[];
  next_check_minutes: number;
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
}): Promise<DecisionResult> {
  const userPrompt = buildUserPrompt({
    current: opts.current,
    recent: opts.recent,
    systemProfile: opts.systemProfile,
    recentActions: opts.recentActions,
    availableChannels: CHANNELS,
    pendingTasks: opts.pendingTasks.map((t) => ({
      id: t.id,
      type: t.type,
      priority: t.priority,
      title: t.title,
      created_at: t.created_at,
    })),
  });

  const modelId = process.env.CHAT_MODEL || "claude-sonnet-4-6";
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
    return fallback(`API error: ${msg}`);
  }

  const text = result.text;
  let aiDecision: Record<string, unknown>;
  try {
    aiDecision = parseJsonResponse(text);
  } catch (e) {
    return fallback(`JSON parse: ${e instanceof Error ? e.message : String(e)}`);
  }

  const approved: ApprovedCommand[] = [];
  const blocked: BlockedCommand[] = [];

  const actions = Array.isArray(aiDecision.actions) ? aiDecision.actions : [];
  for (const a of actions) {
    const action = a as Record<string, unknown>;
    const channelStr = String(action.channel || "");
    const amountMl = Number(action.amount_ml);
    if (!CHANNELS.includes(channelStr as DoserChannel)) {
      blocked.push({
        command: `${channelStr} ${amountMl}ml`,
        reason: `Unknown channel '${channelStr}'`,
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
    const v = await validateCommand(cmd, opts.current);
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
    if (existingTaskTypes.has(type as TaskType)) continue; // dedup
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

function fallback(reason: string): DecisionResult {
  return {
    commands: [],
    blocked_commands: [],
    human_tasks: [],
    analysis: `AI unavailable: ${reason}. Maintaining current state.`,
    message: "המערכת עובדת במצב שמרני — ה-AI לא זמין כרגע",
    status: "attention",
    concerns: [reason],
    next_check_minutes: 5,
    raw_response: { error: reason },
    tokens_input: 0,
    tokens_output: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
  };
}
