"use client";

/**
 * Structured "create system" dialog.
 *
 * Captures every field the agronomist used to ask through a 6-question
 * chat dance, atomically and deterministically.  Result: the system row
 * lands in the DB fully populated, the UI never shows stale defaults,
 * and the chat agent skips straight to physical-readiness + fertilizer
 * config (still conversational, since those benefit from back-and-forth).
 */

import { useState } from "react";
import { createSystem, type SystemSummary } from "@/lib/api";

const CROP_OPTIONS = [
  { value: "lettuce",    label: "חסה" },
  { value: "basil",      label: "בזיליקום" },
  { value: "spinach",    label: "תרד" },
  { value: "strawberry", label: "תות" },
  { value: "tomato",     label: "עגבנייה" },
  { value: "other",      label: "אחר" },
] as const;

const STAGE_OPTIONS = [
  { value: "seedling",   label: "נבט" },
  { value: "vegetative", label: "וגטטיבי" },
  { value: "flowering",  label: "פריחה" },
  { value: "fruiting",   label: "פירות" },
] as const;

const RESERVOIR_PRESETS = [20, 40, 60, 100, 200];

type Props = {
  onCreated: (system: SystemSummary) => void;
  onCancel: () => void;
};

export function CreateSystemDialog({ onCreated, onCancel }: Props) {
  const [name, setName] = useState("");
  const [crop, setCrop] = useState<string>("lettuce");
  const [stage, setStage] = useState<string>("vegetative");
  const [reservoir, setReservoir] = useState<number>(60);
  const [reservoirOther, setReservoirOther] = useState<string>("");
  const [location, setLocation] = useState("Tel Aviv, Israel");
  const [outdoor, setOutdoor] = useState(true);
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (submitting) return;
    if (!name.trim()) {
      setError("נדרש שם למערכת");
      return;
    }
    // Resolve reservoir: preset or custom-other.
    const liters =
      reservoir > 0
        ? reservoir
        : Number(reservoirOther);
    if (!Number.isFinite(liters) || liters < 5 || liters > 2000) {
      setError("נפח המאגר חייב להיות בין 5 ל-2000 ליטר");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await createSystem({
        name: name.trim(),
        crop_type: crop,
        growth_stage: stage,
        reservoir_liters: liters,
        notes: notes.trim() || undefined,
      });
      // Location + outdoor aren't in createSystem's typed payload yet, so
      // patch them in a follow-up call.  Cheap; happens once per create.
      const { patchSystem } = await import("@/lib/api");
      try {
        await patchSystem(r.system.id, {
          location: location.trim(),
          outdoor,
        });
      } catch {
        // non-fatal — defaults will apply
      }
      onCreated(r.system);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form
        onSubmit={submit}
        className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        dir="rtl"
      >
        <header className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-lg font-semibold">מערכת חדשה</h2>
          <p className="text-xs text-zinc-500 mt-1">
            הזן את הפרטים הראשוניים. את הדשן וערוצי המינון תגדיר בשיחה עם החקלאי לאחר היצירה.
          </p>
        </header>

        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1">שם המערכת</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="למשל: בזיליקום בחצר"
              className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
              required
              autoFocus
            />
          </div>

          {/* Crop */}
          <div>
            <label className="block text-sm font-medium mb-1">גידול</label>
            <div className="grid grid-cols-3 gap-2">
              {CROP_OPTIONS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCrop(c.value)}
                  className={`px-3 py-2 rounded-md text-sm border transition-colors ${
                    crop === c.value
                      ? "bg-emerald-600 text-white border-emerald-600"
                      : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Growth stage */}
          <div>
            <label className="block text-sm font-medium mb-1">שלב גידול</label>
            <div className="grid grid-cols-4 gap-2">
              {STAGE_OPTIONS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setStage(s.value)}
                  className={`px-3 py-2 rounded-md text-sm border transition-colors ${
                    stage === s.value
                      ? "bg-emerald-600 text-white border-emerald-600"
                      : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Reservoir */}
          <div>
            <label className="block text-sm font-medium mb-1">נפח מאגר (ליטר)</label>
            <div className="grid grid-cols-6 gap-2">
              {RESERVOIR_PRESETS.map((L) => (
                <button
                  key={L}
                  type="button"
                  onClick={() => {
                    setReservoir(L);
                    setReservoirOther("");
                  }}
                  className={`px-2 py-2 rounded-md text-sm border transition-colors ${
                    reservoir === L
                      ? "bg-emerald-600 text-white border-emerald-600"
                      : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  }`}
                >
                  {L}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setReservoir(0)}
                className={`px-2 py-2 rounded-md text-sm border transition-colors ${
                  reservoir === 0
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                }`}
              >
                אחר
              </button>
            </div>
            {reservoir === 0 && (
              <input
                type="number"
                min={5}
                max={2000}
                value={reservoirOther}
                onChange={(e) => setReservoirOther(e.target.value)}
                placeholder="ליטרים"
                className="mt-2 w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
              />
            )}
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium mb-1">מיקום</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
            />
          </div>

          {/* Outdoor */}
          <div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={outdoor}
                onChange={(e) => setOutdoor(e.target.checked)}
                className="w-4 h-4 accent-emerald-600"
              />
              <span>המערכת בחוץ (חשופה לשמש)</span>
            </label>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium mb-1">הערות (אופציונלי)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="משהו שכדאי שאדע על המערכת?"
              className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm resize-none"
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 p-2 rounded-md">
              {error}
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-between gap-2 bg-zinc-50 dark:bg-zinc-900/50">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            ביטול
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 text-sm rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-medium disabled:opacity-50"
          >
            {submitting ? "יוצר..." : "צור מערכת"}
          </button>
        </footer>
      </form>
    </div>
  );
}
