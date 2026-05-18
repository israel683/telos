/**
 * GET /api/bottle-status?system=<id>
 *
 * Returns the per-channel bottle status for the active system: capacity,
 * remaining, % left, last-7d consumption, daily avg, days-until-empty,
 * and the visual level bucket (ok / low / near_empty / empty / unknown).
 *
 * Used by the dashboard's BottleLevels card.  The autonomous brain
 * consumes the same report via getBottleStatusReport directly — both
 * surfaces stay in lockstep because they call the same library function.
 */
import { NextResponse } from "next/server";
import { getBottleStatusReport } from "@/lib/bottle-status";
import { getSystem } from "@/lib/db";
import { systemIdFromRequest } from "@/lib/system-ctx";

export const maxDuration = 10;

export async function GET(req: Request) {
  const systemId = systemIdFromRequest(req);
  try {
    const report = await getBottleStatusReport(systemId);
    const sys = await getSystem(systemId);
    return NextResponse.json({
      ...report,
      doser_verified: sys?.doser_verified ?? false,
      autonomous_dosing_enabled: sys?.autonomous_dosing_enabled ?? false,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
