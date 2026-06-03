import { NextResponse } from "next/server";
import { getSystem, getGrowerMemory, getRecentEpisodes } from "@/lib/db";
import { systemIdFromRequest } from "@/lib/system-ctx";
import {
  unansweredQuestions,
  isOnboardingComplete,
  growContextView,
  ONBOARDING_CATALOG,
} from "@/lib/grow-profile";
import { getCultivarRecord } from "@/lib/cultivars";

export const maxDuration = 15;

/**
 * Read-only view of a grow's three knowledge layers as the dashboard sees them:
 * the cultivar it's growing, its personal Grow Context (onboarding answers +
 * what's still missing), the Grower Memory, and the Brain's recent episodes.
 */
export async function GET(req: Request) {
  const systemId = systemIdFromRequest(req);
  try {
    const [sys, memory, episodes] = await Promise.all([
      getSystem(systemId),
      getGrowerMemory(systemId),
      getRecentEpisodes(systemId),
    ]);
    if (!sys) {
      return NextResponse.json({ error: `system "${systemId}" not found` }, { status: 404 });
    }
    const profile = sys.grow_profile ?? null;
    const cultivar = getCultivarRecord(sys.cultivar_id ?? sys.crop_type);

    return NextResponse.json({
      system: {
        id: sys.id,
        name: sys.name,
        crop_type: sys.crop_type,
        cultivar_id: sys.cultivar_id,
        growth_stage: sys.growth_stage,
        location: sys.location,
      },
      cultivar: cultivar
        ? { id: cultivar.id, name: cultivar.cultivar, provenance: cultivar.provenance }
        : null,
      grow_profile: profile,
      onboarding: {
        complete: isOnboardingComplete(profile),
        total: ONBOARDING_CATALOG.length,
        unanswered: unansweredQuestions(profile).map((q) => ({
          id: q.id,
          question: q.q,
          required: q.required ?? false,
          type: q.type,
          choices: q.choices ?? null,
        })),
        // Full catalog + current values — lets the Grow screen revise answers,
        // not just complete missing ones.
        fields: growContextView(profile),
      },
      memory: memory.map((m) => ({
        id: m.id,
        ts: m.ts.toISOString(),
        kind: m.kind,
        text: m.text,
      })),
      episodes: episodes.map((e) => ({
        id: e.id,
        ts: e.ts.toISOString(),
        status: e.status,
        summary: e.summary,
      })),
      system_id: sys.id,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
