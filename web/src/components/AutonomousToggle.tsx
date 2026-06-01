"use client";

/**
 * Master safety toggle for autonomous dosing — icon-forward, palette-correct.
 *   autonomous ON  → ph-brain, basil, a soft glow (the Brain runs itself)
 *   manual (verified) → ph-hand-pointing, amber (you approve each dose)
 *   unverified     → ph-warning-circle, stone (run the doser protocol first)
 * Reflects per-system `autonomous_dosing_enabled`; refuses ON until doser_verified.
 */

import { useEffect, useState } from "react";
import { listSystems, setAutonomousDosing, type SystemSummary } from "@/lib/api";
import { getActiveSystem } from "@/lib/system";
import { startVisibilityAwarePolling } from "@/lib/poll";
import { useLang } from "@/lib/i18n";

const POLL_MS = 15_000;

export function AutonomousToggle() {
  const { t } = useLang();
  const [sys, setSys] = useState<SystemSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const r = await listSystems();
      const active = getActiveSystem();
      setSys(r.systems.find((s) => s.id === active) ?? null);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    load();
    return startVisibilityAwarePolling(load, POLL_MS);
  }, []);

  if (!sys || err) return null;

  const on = Boolean(sys.autonomous_dosing_enabled);
  const verified = Boolean(sys.doser_verified);

  async function toggle() {
    if (!sys || busy) return;
    if (!on && !verified) {
      alert(
        "אי אפשר להפעיל דישון אוטונומי לפני אימות הדוזר. בקש בצ'אט להריץ runDoserProtocol, וודא ויזואלית שטיפה יוצאת מכל ערוץ למיכל הנכון."
      );
      return;
    }
    if (!on) {
      const ok = window.confirm(
        "להפעיל דישון אוטונומי? המוח יוכל לירות במשאבות ישירות במחזורים הבאים — עד 250ml/יום מצטבר. מומלץ רק אחרי קריאות יציבות ודוזר מאומת."
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await setAutonomousDosing(sys.id, !on);
      await load();
    } catch (e) {
      alert(`לא הצליח: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const icon = on ? "ph-brain" : verified ? "ph-hand-pointing" : "ph-warning-circle";
  const color = on ? "var(--c-basil)" : verified ? "var(--amber)" : "var(--c-stone)";
  const label = on ? t("Autonomous", "אוטונומי") : t("Manual", "ידני");

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={
        on
          ? "דישון אוטונומי מופעל — המוח יורה משאבות לבד. לחץ לכבות."
          : verified
          ? "דישון אוטונומי כבוי — המוח מציע, אתה מאשר. לחץ להפעיל."
          : "דוזר לא מאומת — הרץ runDoserProtocol בצ'אט קודם."
      }
      className="flex items-center gap-1.5 text-[11px] sm:text-xs px-2 py-1 rounded-md transition-colors disabled:opacity-50"
      style={{
        border: "1px solid color-mix(in srgb, var(--c-parchment) 8%, transparent)",
        background: "var(--surface-warm)",
        color,
      }}
    >
      <i
        className={"ph-light " + icon}
        style={{ fontSize: "1.05rem", textShadow: on ? "0 0 10px color-mix(in srgb, var(--c-basil) 70%, transparent)" : "none" }}
      />
      <span className="font-medium whitespace-nowrap hidden sm:inline">{label}</span>
    </button>
  );
}
