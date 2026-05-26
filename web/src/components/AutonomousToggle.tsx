"use client";

/**
 * Master safety toggle for autonomous dosing.
 *
 * Visible in the nav.  Reflects the per-system `autonomous_dosing_enabled`
 * flag.  Refuses to flip ON if `doser_verified` is FALSE — the grower has
 * to run the doser protocol via the chat agent first.
 *
 * After the v0.2 → v0.3 cleanup this is the SINGLE point of control for
 * whether the cron-driven brain can fire pumps directly or whether its
 * proposals are queued as dose_approval tasks.
 */

import { useEffect, useState } from "react";
import { listSystems, setAutonomousDosing, type SystemSummary } from "@/lib/api";
import { getActiveSystem } from "@/lib/system";

const POLL_MS = 15_000;

export function AutonomousToggle() {
  const [sys, setSys] = useState<SystemSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const r = await listSystems();
      const active = getActiveSystem();
      const found = r.systems.find((s) => s.id === active) ?? null;
      setSys(found);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    load();
    const i = setInterval(load, POLL_MS);
    return () => clearInterval(i);
  }, []);

  if (!sys || err) return null;

  const on = Boolean(sys.autonomous_dosing_enabled);
  const verified = Boolean(sys.doser_verified);

  async function toggle() {
    if (!sys || busy) return;
    if (!on && !verified) {
      alert(
        "אי אפשר להפעיל דישון אוטונומי לפני אימות הדוזר.  בקש בצ'אט להריץ runDoserProtocol, וודא ויזואלית שטיפה יוצאת מכל ערוץ למיכל הנכון."
      );
      return;
    }
    if (!on) {
      const ok = window.confirm(
        "להפעיל דישון אוטונומי?  המוח האוטונומי יוכל לירות במשאבות ישירות במחזורים הבאים — עד 250ml/יום מצטבר.  המלצה: לעשות את זה רק אחרי שראית מספיק קריאות יציבות והדוזר אומת."
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await setAutonomousDosing(sys.id, !on);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`לא הצליח: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={
        on
          ? "דישון אוטונומי מופעל — המוח ירה משאבות לבד.  לחץ לכבות."
          : verified
          ? "דישון אוטונומי כבוי — המוח מציע, אתה מאשר.  לחץ להפעיל."
          : "דוזר לא מאומת — הרץ runDoserProtocol בצ'אט קודם."
      }
      className={`text-[11px] sm:text-xs px-1.5 sm:px-2 py-1 rounded-md border flex items-center gap-1 sm:gap-1.5 transition-colors ${
        on
          ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
          : verified
          ? "border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300"
          : "border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-500"
      } disabled:opacity-50`}
    >
      <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${on ? "bg-emerald-500" : verified ? "bg-amber-500" : "bg-zinc-400"}`} />
      <span className="font-medium whitespace-nowrap">
        {on ? "אוטונומי" : "ידני"}
      </span>
      {/* Hide the secondary tag on mobile — the dot colour already tells
          the verified/unverified story and saves horizontal space. */}
      {!verified && <span className="text-zinc-400 hidden sm:inline whitespace-nowrap">·לא מאומת</span>}
    </button>
  );
}
