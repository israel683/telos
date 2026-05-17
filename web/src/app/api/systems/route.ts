import { NextResponse } from "next/server";
import { listSystems, createSystem, getSystem } from "@/lib/db";

export const maxDuration = 15;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const includeArchived = searchParams.get("archived") === "1";
  try {
    const systems = await listSystems(includeArchived);
    return NextResponse.json({
      systems: systems.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        created_at: s.created_at.toISOString(),
        archived_at: s.archived_at?.toISOString() ?? null,
        crop_type: s.crop_type,
        growth_stage: s.growth_stage,
        reservoir_liters: s.reservoir_liters,
        system_type: s.system_type,
        location: s.location,
        outdoor: s.outdoor,
        ai_cycle_minutes: s.ai_cycle_minutes,
        tuya_device_id: s.tuya_device_id,
        notes: s.notes,
        dosing_config: s.dosing_config,
        setup_completed_at: s.setup_completed_at?.toISOString() ?? null,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-֐-׿]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 32);
  // Append short random suffix to avoid collisions and to keep IDs URL-safe even
  // when name is all-Hebrew (which would yield an empty slug otherwise).
  const suffix = Math.random().toString(36).slice(2, 7);
  return base ? `${base}-${suffix}` : `system-${suffix}`;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      id?: string;
      name: string;
      crop_type?: string;
      growth_stage?: string;
      reservoir_liters?: number;
      system_type?: string;
      location?: string;
      outdoor?: boolean;
      ai_cycle_minutes?: number;
      tuya_device_id?: string | null;
      notes?: string | null;
    };
    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const id = (body.id || slugify(body.name)).trim();
    if (await getSystem(id)) {
      return NextResponse.json({ error: `system with id "${id}" already exists` }, { status: 409 });
    }
    const created = await createSystem({
      id,
      name: body.name.trim(),
      crop_type: body.crop_type,
      growth_stage: body.growth_stage,
      reservoir_liters: body.reservoir_liters,
      system_type: body.system_type,
      location: body.location,
      outdoor: body.outdoor,
      ai_cycle_minutes: body.ai_cycle_minutes,
      tuya_device_id: body.tuya_device_id ?? null,
      notes: body.notes ?? null,
    });
    return NextResponse.json({
      system: {
        ...created,
        created_at: created.created_at.toISOString(),
        archived_at: created.archived_at?.toISOString() ?? null,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
