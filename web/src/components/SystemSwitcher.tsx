"use client";

import { useEffect, useState } from "react";
import { listSystems, deleteSystem, type SystemSummary } from "@/lib/api";
import { getActiveSystem, setActiveSystem, DEFAULT_SYSTEM } from "@/lib/system";
import { CreateSystemDialog } from "./CreateSystemDialog";

export function SystemSwitcher() {
  const [systems, setSystems] = useState<SystemSummary[]>([]);
  const [active, setActive] = useState<string>(DEFAULT_SYSTEM);
  const [open, setOpen] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await listSystems();
      setSystems(r.systems);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    setActive(getActiveSystem());
    load();
  }, []);

  // Re-fetch every time the dropdown opens so the data the grower sees
  // reflects the latest agent updates (e.g. crop_type was lettuce by
  // default, the agronomist changed it to basil via updateSystem — without
  // this refresh the picker keeps showing "lettuce" until a full page
  // reload).
  useEffect(() => {
    if (open) load();
  }, [open]);

  function pick(id: string) {
    setActive(id);
    setActiveSystem(id);
    setOpen(false);
    window.location.reload();
  }

  function handleSystemCreated(system: SystemSummary) {
    setShowCreateDialog(false);
    pick(system.id);
  }

  async function handleDelete(s: SystemSummary, ev: React.MouseEvent) {
    // Don't let the click bubble up to the row's pick() handler.
    ev.stopPropagation();
    ev.preventDefault();
    if (deletingId) return;
    const ok = window.confirm(
      `למחוק לצמיתות את "${s.name}"?\n` +
        "כל הנתונים (קריאות חיישן, החלטות AI, מינונים, היסטוריית צ'אט, משימות) יימחקו ולא ניתן לשחזר."
    );
    if (!ok) return;
    setDeletingId(s.id);
    setError(null);
    try {
      await deleteSystem(s.id);
      // If we just deleted the active system, fall back to no-active.
      if (s.id === active) {
        setActiveSystem(DEFAULT_SYSTEM);
        setActive(DEFAULT_SYSTEM);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  }

  const activeSys = systems.find((s) => s.id === active);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-sm px-3 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-2 max-w-[200px]"
        aria-expanded={open}
      >
        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
        <span className="truncate font-medium">
          {activeSys?.name ||
            (systems.length === 0 ? "אין מערכות" : active === DEFAULT_SYSTEM ? "בחר מערכת" : active)}
        </span>
        <span className="text-zinc-400">▾</span>
      </button>

      {open && (
        <div
          className="absolute end-0 mt-2 w-80 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-lg z-20 overflow-hidden"
          onMouseLeave={() => !deletingId && setOpen(false)}
        >
          {error && (
            <div className="text-xs text-red-600 dark:text-red-400 p-2 bg-red-50 dark:bg-red-950/40">
              {error}
            </div>
          )}

          <ul className="max-h-80 overflow-y-auto">
            {systems.map((s) => (
              <li
                key={s.id}
                className={`flex items-stretch hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors ${
                  s.id === active ? "bg-emerald-50 dark:bg-emerald-950/40" : ""
                }`}
              >
                <button
                  onClick={() => pick(s.id)}
                  className="flex-1 text-right px-3 py-2 min-w-0"
                  disabled={deletingId === s.id}
                >
                  <div className="text-sm font-medium truncate">{s.name}</div>
                  <div className="text-xs text-zinc-500 truncate">
                    {s.crop_type} · {s.reservoir_liters}L · {s.growth_stage}
                  </div>
                </button>
                <button
                  onClick={(ev) => handleDelete(s, ev)}
                  disabled={deletingId !== null}
                  title="מחק לצמיתות"
                  aria-label={`מחק את ${s.name}`}
                  className="px-3 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {deletingId === s.id ? (
                    <span className="text-xs">...</span>
                  ) : (
                    /* trash glyph — kept inline so we don't pull a fresh icon lib */
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  )}
                </button>
              </li>
            ))}
            {systems.length === 0 && (
              <li className="text-sm text-zinc-500 p-3 text-center">אין מערכות עדיין</li>
            )}
          </ul>
          <button
            onClick={() => {
              setOpen(false);
              setShowCreateDialog(true);
            }}
            className="w-full text-right px-3 py-2 border-t border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-medium text-emerald-600 dark:text-emerald-400"
          >
            + מערכת חדשה
          </button>
        </div>
      )}

      {showCreateDialog && (
        <CreateSystemDialog
          onCreated={handleSystemCreated}
          onCancel={() => setShowCreateDialog(false)}
        />
      )}
    </div>
  );
}
