/**
 * POST /api/grow/answer — let the grower answer an onboarding question directly
 * from the Grow screen (rather than only via the chat kickoff). Body:
 * { id: string, value: string }. Merges the answer into systems.grow_profile —
 * the same store the Brain reads — and returns the refreshed onboarding summary.
 *
 * No re-eval is triggered: onboarding answers are profile facts the next Brain
 * cycle picks up; running the LLM per answer would just burn compute.
 */
import { NextResponse } from "next/server";
import { getSystem, mergeGrowProfileKey } from "@/lib/db";
import { systemIdFromRequest } from "@/lib/system-ctx";
import {
  applyOnboardingAnswer,
  unansweredQuestions,
  isOnboardingComplete,
  ONBOARDING_CATALOG,
} from "@/lib/grow-profile";

export const maxDuration = 15;

export async function POST(req: Request) {
  const systemId = systemIdFromRequest(req);

  let id = "";
  let value = "";
  try {
    const body = (await req.json()) as { id?: string; value?: string };
    id = (body.id || "").trim();
    value = (body.value || "").trim();
  } catch {
    /* empty body → handled below */
  }
  if (!id) return NextResponse.json({ error: "question id is required" }, { status: 400 });
  if (!value) return NextResponse.json({ error: "answer is required" }, { status: 400 });

  const sys = await getSystem(systemId);
  if (!sys) {
    return NextResponse.json({ error: `system "${systemId}" not found` }, { status: 404 });
  }

  let nextProfile;
  try {
    nextProfile = applyOnboardingAnswer(sys.grow_profile ?? null, id, value);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }

  // Write ONLY the top-level key(s) this answer changed, atomically per key — so
  // a concurrent cron write to a sibling key (timeline / harvest_plan) is never
  // clobbered by a whole-blob overwrite built from a stale snapshot.
  // applyOnboardingAnswer always touches exactly one top-level key (the field,
  // or `water_baseline` / `practices`); the diff resolves it generically.
  const cur = (sys.grow_profile ?? {}) as Record<string, unknown>;
  const next = nextProfile as Record<string, unknown>;
  for (const k of Object.keys(next)) {
    if (next[k] !== cur[k]) {
      await mergeGrowProfileKey(systemId, k, next[k]);
    }
  }

  return NextResponse.json({
    ok: true,
    onboarding: {
      complete: isOnboardingComplete(nextProfile),
      total: ONBOARDING_CATALOG.length,
      unanswered: unansweredQuestions(nextProfile).map((q) => ({
        id: q.id,
        question: q.q,
        required: q.required ?? false,
        type: q.type,
        choices: q.choices ?? null,
      })),
    },
  });
}
