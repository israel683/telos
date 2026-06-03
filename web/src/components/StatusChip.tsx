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
  // Connectivity: distinguish "still loading the first time" from "we polled
  // and it FAILED". On failure we keep the last-known status visible (so the
  // chip doesn't lie) but mark it offline — the global "can't reach the Brain"
  // signal the rest of the chrome can rely on.
  const [offline, setOffline] = useState(false);

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
      setOffline(false);
    } catch {
      // Keep the last-known `info`; just flag that we can't reach the server.
      setOffline(true);
    }
  }

  useEffect(() => {
    load();
    return startVisibilityAwarePolling(load, 30_000);
  }, []);

  // Persistent failure with nothing ever loaded → explicit "no connection".
  if (offline && !info) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs px-2 py-1 rounded-sm border border-[rgba(168,89,58,0.25)] bg-[rgba(168,89,58,0.08)] text-[var(--c-terra)] font-medium"
        title={t("Can't reach the Brain — retrying", "אין קשר למוח — מנסה שוב")}
      >
        <span className="inline-block w-2 h-2 rounded-full bg-[var(--c-terra)]" />
        {t("Offline", "אין קשר")}
      </span>
    );
  }

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
    <span
      className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs px-2 py-1 rounded-sm border border-[rgba(238,237,232,0.07)] bg-[var(--c-soil)]"
      style={offline ? { opacity: 0.55 } : undefined}
      title={offline ? t("Showing last-known status — can't reach the Brain", "מציג מצב אחרון ידוע — אין כרגע קשר למוח") : undefined}
    >
      <span className={`inline-block w-2 h-2 rounded-full ${style.dot}`} />
      <span className="text-[var(--c-fog)] font-medium">{statusLabel(ds, t)}</span>
      {offline ? <span className="text-[var(--c-terra)]" aria-hidden="true">⚠</span> : null}
    </span>
  );
}
