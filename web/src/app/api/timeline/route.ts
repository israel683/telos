import { NextResponse } from "next/server";
import { ensureSchema, getSystem, getRecentEpisodes, getTasksByStatus } from "@/lib/db";
import { systemIdFromRequest } from "@/lib/system-ctx";
import { deriveTimeline } from "@/lib/grow-profile";
import { buildJournal, episodeToJournalEvent } from "@/lib/journal";
import { resolveCultivarHarvest } from "@/lib/cultivars";

export const maxDuration = 15;

/**
 * The Grow Timeline as the dedicated /grow/timeline tab sees it:
 *   - `forward`  — the Brain-owned plan (grow_profile.timeline) or, until it
 *                  exists, the same derived view /grow shows. Identical source,
 *                  never re-derived elsewhere.
 *   - `past`     — the grower-safe JOURNAL (episodes + grower/manual tasks),
 *                  built through the journal allowlist mapper (NO confidential
 *                  decision/token/payload fields ever reach the client).
 * Bounded to a `days` window (default 30); `truncated` is honest when capped.
 */
export async function GET(req: Request) {
  const systemId = systemIdFromRequest(req);
  const url = new URL(req.url);
  const daysRaw = parseInt(url.searchParams.get("days") ?? "30", 10);
  const days = Number.isFinite(daysRaw) ? Math.min(365, Math.max(1, daysRaw)) : 30;
  const windowStart = new Date(Date.now() - days * 86_400_000);

  try {
    // Once up-front so the parallel reads below don't each race the DDL bootstrap.
    await ensureSchema();
    const sys = await getSystem(systemId);
    if (!sys) {
      return NextResponse.json({ error: `system "${systemId}" not found` }, { status: 404 });
    }

    // Lean snapshot for the dashboard: just the next planned event + the last
    // thing that happened. Avoids the full journal fetch (one tiny episode read).
    if (url.searchParams.get("snapshot")) {
      const profile = sys.grow_profile ?? null;
      const forward =
        profile?.timeline && profile.timeline.length ? profile.timeline : deriveTimeline(profile);
      const next =
        forward.find((e) => e.status === "planned" || e.status === "due") ?? null;
      const recent = await getRecentEpisodes(systemId, 1);
      const last = recent[0] ? episodeToJournalEvent(recent[0]) : null;
      // The cycle anchor lets the dashboard's words-picture say "day N" — the
      // TELOS voice ("Day 21", not "how's it going"). Same resolution order as
      // the full path below.
      const iso10s = (d: Date | string | null | undefined) =>
        d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : null;
      const anchor_date =
        profile?.grow_anchor_date ??
        profile?.onboarding_completed_at?.slice(0, 10) ??
        iso10s(sys.setup_completed_at) ??
        iso10s(sys.created_at);
      return NextResponse.json({ next, last, anchor_date });
    }

    const [episodes, doneTasks, dismissedTasks, expiredTasks] = await Promise.all([
      getRecentEpisodes(systemId, 80),
      getTasksByStatus("done", systemId, { since: windowStart, limit: 80 }),
      getTasksByStatus("dismissed", systemId, { since: windowStart, limit: 40 }),
      getTasksByStatus("expired", systemId, { since: windowStart, limit: 40 }),
    ]);

    const profile = sys.grow_profile ?? null;
    const forward =
      profile?.timeline && profile.timeline.length ? profile.timeline : deriveTimeline(profile);
    const { events: past, truncated } = buildJournal(
      episodes,
      [...doneTasks, ...dismissedTasks, ...expiredTasks],
      windowStart,
      60
    );

    // Grow context for the roadmap/Gantt view: where the cycle is anchored,
    // where the grower is now, and the harvest cadence for projecting repeats.
    const harvest = resolveCultivarHarvest(sys.cultivar_id);
    const iso10 = (d: Date | string | null | undefined) =>
      d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : null;
    const anchor_date =
      profile?.grow_anchor_date ??
      profile?.onboarding_completed_at?.slice(0, 10) ??
      iso10(sys.setup_completed_at) ??
      iso10(sys.created_at);
    const grow = {
      anchor_date,
      growth_stage: sys.growth_stage,
      crop_type: sys.crop_type,
      cultivar_id: sys.cultivar_id,
      harvest_mode: harvest?.mode ?? null,
      harvest_cadence_days: harvest?.cadence_days ?? null,
    };

    return NextResponse.json({ forward, past, grow, windowDays: days, truncated });
  } catch (e) {
    console.error("[/api/timeline] failed:", e);
    return NextResponse.json({ error: "timeline unavailable" }, { status: 500 });
  }
}
