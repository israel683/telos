"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import { pushSupported, pushPermission, enablePush } from "@/lib/push-client";

const DISMISS_KEY = "telos-notify-dismissed";

/**
 * A tasteful, contextual soft-ask for notification permission — shown only when
 * push is supported, not yet decided, and not dismissed. Never a cold browser
 * prompt; the grower opts in from this card.
 */
export function NotifyOptIn() {
  const { t } = useLang();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported()) return;
    if (pushPermission() !== "default") return; // already granted or denied — don't nag
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
    setShow(true);
  }, []);

  if (!show) return null;

  const onEnable = async () => {
    setBusy(true);
    await enablePush();
    setBusy(false);
    setShow(false); // granted → done; denied → don't re-nag
  };
  const onDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch {}
    setShow(false);
  };

  return (
    <section className="tk-card glow tk-rise" style={{ padding: "16px 20px", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
      <i className="ph-light ph-bell-ringing" style={{ color: "var(--c-basil)", fontSize: "1.5rem", flex: "none" }} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontFamily: "var(--f-display)", fontSize: "1.15rem", color: "var(--c-parchment)", lineHeight: 1.2 }}>
          {t("Get notified when TELOS needs you", "קבל התראה כש‑TELOS צריך אותך")}
        </div>
        <div style={{ fontSize: ".88rem", color: "var(--c-ash)", marginTop: 4, lineHeight: 1.45 }}>
          {t(
            "TELOS will ask you to dose or act by hand — turn on alerts so you never miss a window, even when the app is closed.",
            "TELOS יבקש ממך לדשן או לפעול ידנית — הפעל התראות כדי לא לפספס חלון, גם כשהאפליקציה סגורה.",
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flex: "none" }}>
        <button className="tk-btn" onClick={onEnable} disabled={busy}>
          {busy ? "…" : t("Enable alerts", "הפעל התראות")}
        </button>
        <button className="tk-btn-ghost" onClick={onDismiss}>{t("Not now", "לא עכשיו")}</button>
      </div>
    </section>
  );
}
