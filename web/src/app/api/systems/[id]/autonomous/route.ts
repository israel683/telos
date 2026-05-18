/**
 * POST /api/systems/[id]/autonomous { enabled: bool }
 *
 * Master safety toggle.  Flips `autonomous_dosing_enabled` on the system
 * row.  Only flipped to TRUE if the doser has been verified
 * (doser_verified=TRUE) — protects against the failure mode where a
 * grower enables autonomous on a rig whose pumps have never been visually
 * confirmed to work.
 */
import { NextResponse } from "next/server";
import { getSystem, setAutonomousDosing } from "@/lib/db";

export const maxDuration = 15;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { enabled?: boolean };
  try {
    body = (await req.json()) as { enabled?: boolean };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const enabled = Boolean(body.enabled);

  const sys = await getSystem(id);
  if (!sys) {
    return NextResponse.json({ error: "system not found" }, { status: 404 });
  }
  if (enabled && !sys.doser_verified) {
    return NextResponse.json(
      {
        error:
          "Cannot enable autonomous dosing — doser_verified is FALSE. Run the doser protocol first (the chat agent has a `runDoserProtocol` tool) and visually confirm each channel pumps the right bottle.",
      },
      { status: 412 }
    );
  }
  await setAutonomousDosing(id, enabled);
  return NextResponse.json({
    ok: true,
    autonomous_dosing_enabled: enabled,
    note: enabled
      ? "Autonomous dosing ENABLED. The cron cycle will execute pumps directly when the brain decides to dose. Daily cap is 250ml across all channels."
      : "Autonomous dosing DISABLED. The cron cycle will queue dose proposals as Human Tasks for you to approve in the dashboard.",
  });
}
