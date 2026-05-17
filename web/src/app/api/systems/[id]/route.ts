import { NextResponse } from "next/server";
import { getSystem, updateSystem, archiveSystem, saveChatMessage, sql, ensureSchema } from "@/lib/db";

export const maxDuration = 15;

function serialize(s: NonNullable<Awaited<ReturnType<typeof getSystem>>>) {
  return {
    ...s,
    created_at: s.created_at.toISOString(),
    archived_at: s.archived_at?.toISOString() ?? null,
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sys = await getSystem(id);
  if (!sys) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ system: serialize(sys) });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await req.json()) as Partial<{
      name: string;
      status: "active" | "paused" | "archived";
      crop_type: string;
      growth_stage: string;
      reservoir_liters: number;
      system_type: string;
      location: string;
      outdoor: boolean;
      ai_cycle_minutes: number;
      tuya_device_id: string | null;
      notes: string | null;
      dosing_config: Record<string, unknown> | null;
    }>;

    // Capture pre-state so we can detect transitions worth narrating in the
    // chat thread (e.g. paused → active = "resumed maintenance").
    const before = await getSystem(id);
    if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });

    const updated = await updateSystem(id, body);
    if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });

    const enteredMaintenance = before.status !== "paused" && updated.status === "paused";
    const exitedMaintenance = before.status === "paused" && updated.status === "active";

    if (enteredMaintenance) {
      try {
        await saveChatMessage({
          systemId: id,
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "🛠 המערכת עברה למצב תחזוקה. אני מפסיק לקבל החלטות אוטונומיות ואת המינונים עד שתשחרר אותי. אם תרצה — עדכן אותי בצ'אט מה אתה עושה, ואני אזכור.",
            },
          ],
          source: "system",
          status: "paused",
        });
      } catch (e) {
        console.error("[maint-enter] chat push failed:", e);
      }
    } else if (exitedMaintenance) {
      try {
        await saveChatMessage({
          systemId: id,
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "▶ ברוך הבא בחזרה. סיימת תחזוקה. ספר לי בקצרה מה שינית במערכת — אני שואל כדי שאוכל להחליט נכון על המשך. (גם דברים שנראים קטנים: זווית שמש, כיול חיישן, חומר חדש בדישון...)",
            },
          ],
          source: "system",
          status: "active",
        });
      } catch (e) {
        console.error("[maint-exit] chat push failed:", e);
      }
    }

    return NextResponse.json({
      system: serialize(updated),
      transition: enteredMaintenance ? "entered_maintenance" : exitedMaintenance ? "exited_maintenance" : null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const hard = searchParams.get("hard") === "1";

  if (!hard) {
    // Default behaviour preserved: soft-archive (status='archived', data kept).
    await archiveSystem(id);
    return NextResponse.json({ ok: true, mode: "archived" });
  }

  // Hard delete — cascade every child row tied to this system_id, then drop
  // the system itself.  Used by the UI trash button when the grower wants
  // the system permanently gone (not just hidden from the active list).
  await ensureSchema();
  const s = sql();
  // Order: child tables first to honour FKs (decisions referenced by tasks +
  // dosing_actions).  We DELETE by system_id so an accidental id collision
  // on another system's rows is impossible.
  await s`DELETE FROM dosing_actions WHERE system_id = ${id}`;
  await s`DELETE FROM human_tasks WHERE system_id = ${id}`;
  await s`DELETE FROM chat_messages WHERE system_id = ${id}`;
  await s`DELETE FROM ai_decisions WHERE system_id = ${id}`;
  await s`DELETE FROM sensor_readings WHERE system_id = ${id}`;
  const removed = (await s`DELETE FROM systems WHERE id = ${id} RETURNING id`) as unknown as Array<{ id: string }>;
  return NextResponse.json({
    ok: true,
    mode: "hard_deleted",
    deleted_system: removed[0]?.id ?? null,
  });
}
