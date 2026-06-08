/**
 * Grower-facing JOURNAL — the backward half of the Grow Timeline: a forensic,
 * day-groupable log of what already happened to a grow (system milestones the
 * Brain narrated + actions/answers the grower took).
 *
 * IP BOUNDARY (the sharpest risk in this feature): the source rows carry
 * confidential internals — ai_decisions.raw_response / tokens_* / cache_*,
 * dosing_actions.decision_id / ai_status, human_tasks.decision_id / system_id /
 * payload. `toJournalEvent*` therefore CONSTRUCTS each event from a fixed
 * allowlist of named, grower-safe fields — it NEVER spreads a source row. A new
 * confidential column added upstream cannot leak here unless someone explicitly
 * maps it. Synthetic `id`s ("episode:N"/"task:N") never expose a raw decision_id.
 */

import type { GrowEpisode } from "./grower-memory";
import type { HumanTask } from "./db";

export type JournalLane = "milestone" | "action" | "task" | "note";
export type JournalTone = "good" | "attention" | "bad" | "neutral";

export type JournalEvent = {
  /** Synthetic, source-prefixed id — stable for React keys; never a raw decision_id. */
  id: string;
  /** ISO timestamp the thing happened. */
  ts: string;
  lane: JournalLane;
  /** Phosphor (ph-light) icon name for the lane. */
  icon: string;
  /** Grower-facing, already in the grower's language (Brain/grower authored it). */
  title: string;
  detail: string | null;
  tone: JournalTone;
  by: "brain" | "grower";
};

function toneFromStatus(status: string | null): JournalTone {
  switch (status) {
    case "healthy":
      return "good";
    case "attention":
    case "warning":
      return "attention";
    case "critical":
      return "bad";
    default:
      return "neutral";
  }
}

// Episodes whose summary opens with one of these are the grower's own actions,
// not the Brain's — so the journal can attribute "by" correctly.
const GROWER_EPISODE_PREFIXES = ["המגדל", "Grower", "grower"];

/** grow_episodes → JournalEvent. Allowlist: id, ts, status, summary only. */
export function episodeToJournalEvent(e: GrowEpisode): JournalEvent {
  const summary = e.summary ?? "";
  const by: JournalEvent["by"] = GROWER_EPISODE_PREFIXES.some((p) => summary.startsWith(p))
    ? "grower"
    : "brain";
  const significant = e.status != null;
  return {
    id: `episode:${e.id}`,
    ts: e.ts.toISOString(),
    lane: significant ? "milestone" : "note",
    icon: by === "grower" ? "ph-user" : significant ? "ph-seal-check" : "ph-note",
    title: summary,
    detail: null,
    tone: toneFromStatus(e.status),
    by,
  };
}

const TASK_LANE: Record<string, JournalLane> = {
  manual_action: "action",
  water_change: "action",
  question: "task",
  dose_approval: "task",
  system_reset: "action",
};
const TASK_ICON: Record<string, string> = {
  manual_action: "ph-hand-pointing",
  water_change: "ph-drop",
  question: "ph-chat-circle",
  dose_approval: "ph-eyedropper",
  system_reset: "ph-arrows-clockwise",
};

/**
 * human_tasks (done/dismissed/expired) → JournalEvent. Allowlist: id, type,
 * title, reason, status, user_response, completed_at, created_at. STRIPPED:
 * system_id, decision_id, payload, priority, expires_at.
 */
export function taskToJournalEvent(t: HumanTask): JournalEvent {
  const happenedAt = t.completed_at ?? t.created_at;
  const tone: JournalTone =
    t.status === "done" ? "good" : t.status === "expired" ? "attention" : "neutral";
  // Prefer the grower's own response, else the (Brain-authored, voice-compliant)
  // reason. Never the payload (may carry internal ids).
  const detail =
    t.user_response && t.user_response.trim() ? t.user_response : t.reason || null;
  return {
    id: `task:${t.id}`,
    ts: (happenedAt instanceof Date ? happenedAt : new Date(happenedAt)).toISOString(),
    lane: TASK_LANE[t.type] ?? "task",
    icon: TASK_ICON[t.type] ?? "ph-check-circle",
    title: t.title,
    detail,
    tone,
    by: "grower",
  };
}

/**
 * Build the bounded, chronological (newest-first) journal from episodes + tasks
 * within a window. Returns `truncated` when the cap was hit, so the UI states
 * "showing last N days" rather than silently hiding older history.
 */
export function buildJournal(
  episodes: GrowEpisode[],
  tasks: HumanTask[],
  windowStart: Date,
  cap = 60
): { events: JournalEvent[]; truncated: boolean } {
  const startMs = windowStart.getTime();
  const all: JournalEvent[] = [
    ...episodes.map(episodeToJournalEvent),
    ...tasks.map(taskToJournalEvent),
  ].filter((ev) => Date.parse(ev.ts) >= startMs);
  all.sort((a, b) => b.ts.localeCompare(a.ts));
  return { events: all.slice(0, cap), truncated: all.length > cap };
}
