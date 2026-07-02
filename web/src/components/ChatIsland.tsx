"use client";

/**
 * The Chat Island — TELOS's persistent conversational presence.
 *
 * A calm, floating bar pinned to the bottom of EVERY screen (not a separate
 * page). It is two things at once:
 *   1. the always-reachable way to talk to TELOS, and
 *   2. the surface where the system reaches the grower — pending tasks
 *      ("things to do") light it up amber, so the grower always sees what
 *      needs a hand without hunting through a page.
 *
 * Collapsed → a single tap expands a bottom sheet holding the full ChatPanel.
 * The panel is mounted lazily on first open and kept warm afterwards, but its
 * 13s live-update poll is gated on `expanded` so a background presence never
 * burns the Neon compute budget. The collapsed bar runs one lean, 25s,
 * visibility-aware task count so the "things to do" signal stays fresh.
 *
 * Hidden on /chat (that route IS the full-screen conversation) and on the
 * standalone marketing site (/site/*).
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ChatPanel } from "./ChatPanel";
import { getTasks } from "@/lib/api";
import { startVisibilityAwarePolling } from "@/lib/poll";
import { useLang } from "@/lib/i18n";

const COUNT_POLL_MS = 25_000;

export function ChatIsland() {
  const pathname = usePathname();
  const { t, lang } = useLang();
  const [expanded, setExpanded] = useState(false);
  // The heavy ChatPanel only mounts once the grower opens the island for the
  // first time — keeps first paint (and the history fetch) off every screen.
  const [hasOpened, setHasOpened] = useState(false);
  const [pending, setPending] = useState(0);

  // The island is the primary chat everywhere EXCEPT the full-screen /chat
  // route (would double the conversation) and the standalone marketing site.
  const hidden = !pathname || pathname === "/chat" || pathname.startsWith("/site");

  // Lean "things to do" signal — only while collapsed (the expanded panel's
  // PendingTasksCard owns freshness then, so we don't double-poll). Collapsing
  // re-runs the fetch immediately via the effect re-subscribe.
  useEffect(() => {
    if (hidden || expanded) return;
    let stopped = false;
    const load = async () => {
      try {
        const r = await getTasks("pending");
        if (!stopped) setPending(r.tasks.length);
      } catch {
        // transient — keep the last-known count; next tick retries
      }
    };
    load();
    const stop = startVisibilityAwarePolling(load, COUNT_POLL_MS);
    return () => {
      stopped = true;
      stop();
    };
  }, [hidden, expanded]);

  // Lock background scroll + wire Escape while the sheet is open.
  useEffect(() => {
    if (!expanded) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  // Route change (e.g. tapping a nav tab) collapses the sheet — the grower is
  // navigating, not chatting. The panel stays mounted (state warm).
  useEffect(() => {
    setExpanded(false);
  }, [pathname]);

  if (hidden) return null;

  const attention = pending > 0;
  const primary = attention
    ? pending === 1
      ? t("One thing needs you", "דבר אחד ממתין לך")
      : t(`${pending} things need you`, `${pending} דברים ממתינים לך`)
    : t("Ask TELOS", "שוחח עם TELOS");
  const secondary = attention
    ? t("Tap to review", "הקש כדי לטפל")
    : t("I'm watching the grow", "אני עוקב אחרי הגידול");

  const dir = lang === "he" ? "rtl" : "ltr";
  const dotColor = attention ? "var(--amber)" : "var(--c-basil)";
  const dotHalo = attention
    ? "color-mix(in srgb, var(--amber) 22%, transparent)"
    : "color-mix(in srgb, var(--c-basil) 18%, transparent)";

  return (
    <>
      {/* Reserve bottom space so the fixed island never covers page content. */}
      <div
        aria-hidden="true"
        style={{ height: "calc(3.5rem + 1.2rem + max(0.6rem, env(safe-area-inset-bottom)))" }}
      />

      {/* Collapsed island bar — fixed to the bottom, pointer-events only on the
          button itself so the side gutters stay tappable through to content. */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 px-3 pointer-events-none"
        style={{ paddingBottom: "max(0.6rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto" style={{ maxWidth: "var(--page-max)" }}>
          <button
            type="button"
            onClick={() => {
              setHasOpened(true);
              setExpanded(true);
            }}
            aria-label={t("Open chat with TELOS", "פתח שיחה עם TELOS")}
            dir={dir}
            className="pointer-events-auto w-full flex items-center gap-3 rounded-2xl px-4 h-14 transition-opacity duration-200"
            style={{
              background: "color-mix(in srgb, var(--surface-warm) 92%, transparent)",
              backdropFilter: "blur(18px) saturate(1.3)",
              WebkitBackdropFilter: "blur(18px) saturate(1.3)",
              border: "1px solid color-mix(in srgb, var(--c-parchment) 10%, transparent)",
              boxShadow: "var(--glow-shadow)",
              opacity: expanded ? 0 : 1,
            }}
          >
            {/* Living presence dot — basil when calm, amber + a ping when there's
                something to do. */}
            <span
              className="relative shrink-0 flex items-center justify-center rounded-full"
              style={{ width: 28, height: 28, background: dotHalo }}
            >
              {attention && (
                <span
                  className="absolute inline-flex h-full w-full rounded-full animate-ping"
                  style={{ background: "color-mix(in srgb, var(--amber) 35%, transparent)" }}
                />
              )}
              <span
                className="relative rounded-full"
                style={{ width: 9, height: 9, background: dotColor }}
              />
            </span>
            <span className="flex-1 min-w-0 text-start">
              <span className="block text-sm font-medium truncate" style={{ color: "var(--c-parchment)" }}>
                {primary}
              </span>
              <span className="block text-[11px] truncate" style={{ color: "var(--c-stone)" }}>
                {secondary}
              </span>
            </span>
            <i
              className="ph-light ph-caret-up shrink-0"
              style={{ color: "var(--c-stone)", fontSize: "1.1rem" }}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      {/* Bottom sheet — mounted lazily on first open, then kept warm. Collapsed
          state translates it off-screen and marks it inert (no focus trap). */}
      {hasOpened && (
        <>
          <div
            aria-hidden="true"
            onClick={() => setExpanded(false)}
            className="fixed inset-0 z-40 transition-opacity duration-300"
            style={{
              background: "color-mix(in srgb, var(--c-void) 55%, transparent)",
              backdropFilter: "blur(2px)",
              WebkitBackdropFilter: "blur(2px)",
              opacity: expanded ? 1 : 0,
              pointerEvents: expanded ? "auto" : "none",
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("Chat with TELOS", "שיחה עם TELOS")}
            inert={!expanded}
            dir={dir}
            className="fixed inset-x-0 bottom-0 z-50 flex flex-col transition-transform duration-300 ease-out"
            style={{
              height: "88dvh",
              maxHeight: "88dvh",
              transform: expanded ? "translateY(0)" : "translateY(100%)",
              background: "var(--c-void)",
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderTop: "1px solid color-mix(in srgb, var(--c-parchment) 10%, transparent)",
              boxShadow: "0 -12px 40px color-mix(in srgb, var(--c-void) 60%, transparent)",
            }}
          >
            {/* Header — grab handle, a quiet TELOS label, and a close control. */}
            <div className="shrink-0 relative flex items-center gap-3 px-4 pt-3 pb-2">
              <span
                aria-hidden="true"
                className="absolute top-1.5 start-1/2 rounded-full"
                style={{
                  width: 38,
                  height: 4,
                  transform: "translateX(-50%)",
                  background: "color-mix(in srgb, var(--c-parchment) 18%, transparent)",
                }}
              />
              <div className="flex-1 min-w-0 pt-1.5">
                <div className="t-wordmark text-sm" style={{ color: "var(--c-parchment)" }}>
                  TELOS
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                aria-label={t("Close", "סגור")}
                className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors"
                style={{ color: "var(--c-fog)", background: "var(--surface-warm)" }}
              >
                <i className="ph-light ph-caret-down" style={{ fontSize: "1.2rem" }} aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 min-h-0">
              <ChatPanel variant="island" active={expanded} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
