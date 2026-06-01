"use client";

import { useEffect, useState } from "react";
import { getActiveSystem } from "@/lib/system";
import { startVisibilityAwarePolling } from "@/lib/poll";
import { useLang, statusLabel } from "@/lib/i18n";

type StatusInfo = {
  systemStatus: "active" | "paused" | "archived" | null;
  decisionStatus: "healthy" | "attention" | "warning" | "critical" | "unknown" | null;
  systemName: string | null;
  hasReadings: boolean;
};

// TELOS palette mapping: basil = healthy, terra (warm) = anything that
// needs attention, escalating in opacity/intensity for critical.
// Per the brand kit, basil and terra are the only accents that carry
// status meaning; we don't use amber / orange / red separately.
const DECISION_STYLE: Record<string, { dot: string; label: string }> = {
  healthy:   { dot: "bg-[var(--c-basil)]",                   label: "תקין" },
  attention: { dot: "bg-[var(--c-terra)] opacity-60",         label: "לב" },
  warning:   { dot: "bg-[var(--c-terra)] opacity-85",         label: "אזהרה" },
  critical:  { dot: "bg-[var(--c-terra)]",                    label: "קריטי" },
  unknown:   { dot: "bg-[var(--c-stone)]",                    label: "—" },
};

export function StatusChip({ onRequestStatus }: { onRequestStatus?: () => void }) {
  const { t } = useLang();
  const [info, setInfo] = useState<StatusInfo | null>(null);

  async function load() {
    try {
      const sys = getActiveSystem();
      const qs = sys && sys !== "default" ? `?system=${encodeURIComponent(sys)}` : "";
      const r = await fetch(`/api/state${qs}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`${r.status}`);
      const j = await r.json();
      setInfo({
        systemStatus: j.system?.status ?? "active",
        decisionStatus: j.last_decision?.status ?? "unknown",
        systemName: j.system?.name ?? null,
        hasReadings: !!j.current_reading,
      });
    } catch {
      setInfo(null);
    }
  }

  useEffect(() => {
    load();
    return startVisibilityAwarePolling(load, 30_000);
  }, []);

  if (!info) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs px-2 py-1 rounded-sm border border-[rgba(238,237,232,0.07)] bg-[var(--c-soil)] text-[var(--c-stone)]">
        <span className="inline-block w-2 h-2 rounded-full bg-[var(--c-stone)] animate-pulse" />
        {t("Loading", "טוען")}
      </span>
    );
  }

  // Maintenance overrides decision status
  if (info.systemStatus === "paused") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs px-2 py-1 rounded-sm border border-[rgba(168,89,58,0.25)] bg-[rgba(168,89,58,0.08)] text-[var(--c-terra)] font-medium">
        {t("Maintenance", "בתחזוקה")}
      </span>
    );
  }

  if (info.systemStatus === "archived") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs px-2 py-1 rounded-sm border border-[rgba(238,237,232,0.07)] bg-[var(--c-soil)] text-[var(--c-stone)]">
        {t("Archived", "בארכיון")}
      </span>
    );
  }

  // First-visit nudge: no readings yet → invite the grower to kick off a poll
  if (!info.hasReadings && onRequestStatus) {
    return (
      <button
        onClick={onRequestStatus}
        className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs px-2 py-1 rounded-sm border border-[rgba(137,168,62,0.25)] bg-[rgba(137,168,62,0.06)] text-[var(--c-basil)] font-medium hover:bg-[rgba(137,168,62,0.12)] transition-colors"
      >
        {t("Status →", "סטטוס ←")}
      </button>
    );
  }

  const ds = info.decisionStatus || "unknown";
  const style = DECISION_STYLE[ds] || DECISION_STYLE.unknown;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs px-2 py-1 rounded-sm border border-[rgba(238,237,232,0.07)] bg-[var(--c-soil)]">
      <span className={`inline-block w-2 h-2 rounded-full ${style.dot}`} />
      <span className="text-[var(--c-fog)] font-medium">{statusLabel(ds, t)}</span>
    </span>
  );
}
