/**
 * Time helpers for agent prompts + tool outputs.
 *
 * An LLM has no clock and subtracts ISO timestamps unreliably. So we do the
 * arithmetic in code (which has a real clock) and hand the model a
 * pre-computed, human-readable AGE for every timestamped fact — plus a single
 * "now" anchor. The model never has to compute elapsed time itself; it reads
 * "(12m ago)" and compares against the stated current time.
 */

/** Compact relative age of a past timestamp vs `now`, e.g. "just now", "12m ago", "3h 20m ago", "2d 4h ago". */
export function relAge(ts: Date | string | null | undefined, now: Date = new Date()): string {
  if (ts == null) return "unknown";
  const t = typeof ts === "string" ? new Date(ts) : ts;
  const ms = now.getTime() - t.getTime();
  if (!Number.isFinite(ms)) return "unknown";
  if (ms < -60_000) return "in the future";
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m ago` : `${h}h ago`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h ago` : `${d}d ago`;
}

/** ISO minute precision in UTC, e.g. "2026-06-03T11:42Z". */
export function isoMinuteUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 16) + "Z";
}

/**
 * A "now" anchor block for an agent prompt. Tells the model the current time
 * and that elapsed time must be read from the "(… ago)" labels on data — never
 * guessed.
 */
export function nowAnchorBlock(now: Date = new Date()): string {
  return [
    "# Current time",
    `- Now (UTC): ${isoMinuteUtc(now)}`,
    "- You have NO internal clock. To judge how much time has passed (\"has it been 10 minutes since the dose?\"), read the \"(… ago)\" age label attached to each reading, dose, decision and task in tool results / context, and compare against the time above. Never guess elapsed time.",
  ].join("\n");
}
