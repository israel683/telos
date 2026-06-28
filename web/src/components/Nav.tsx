"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SystemSwitcher } from "./SystemSwitcher";
import { StatusChip } from "./StatusChip";
import { MaintenanceToggle } from "./MaintenanceToggle";
import { TasksBadge } from "./TasksBadge";
import { AutonomousToggle } from "./AutonomousToggle";
import { LanguageToggle } from "./LanguageToggle";
import { useLang } from "@/lib/i18n";

// The architecture page documents how TELOS is built — proprietary IP. It is
// hidden from the customer-facing app by default; the team enables it with
// NEXT_PUBLIC_SHOW_ARCHITECTURE=1 (e.g. locally or a protected preview).
const SHOW_ARCHITECTURE = process.env.NEXT_PUBLIC_SHOW_ARCHITECTURE === "1";

const LINKS = [
  { href: "/", en: "Dashboard", he: "לוח בקרה", icon: "ph-squares-four" },
  { href: "/grow", en: "The Grow", he: "הגידול", icon: "ph-plant" },
  { href: "/grow/timeline", en: "Timeline", he: "ציר הזמן", icon: "ph-clock-countdown" },
  { href: "/cultivars", en: "Cultivars", he: "קולטיברים", icon: "ph-leaf" },
  { href: "/chat", en: "Chat", he: "שיחה", icon: "ph-chat-circle" },
  { href: "/decisions", en: "Decisions", he: "החלטות", icon: "ph-list-checks" },
  { href: "/changelog", en: "Change Log", he: "עדכונים", icon: "ph-scroll" },
  ...(SHOW_ARCHITECTURE
    ? [{ href: "/architecture", en: "Architecture", he: "ארכיטקטורה", icon: "ph-tree-structure" }]
    : []),
];

/** Overflow (⋯) menu — holds the quieter controls (pause/resume, …). */
function OverflowMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="more"
        aria-expanded={open}
        className="flex items-center justify-center w-8 h-8 rounded-md transition-colors"
        style={{ border: "1px solid color-mix(in srgb, var(--c-parchment) 8%, transparent)", background: "var(--surface-warm)", color: "var(--c-fog)" }}
      >
        <i className="ph-light ph-dots-three-vertical" style={{ fontSize: "1.1rem" }} />
      </button>
      {open && (
        <div
          className="absolute end-0 mt-2 w-52 rounded-lg overflow-hidden z-40"
          style={{ background: "var(--surface-warm)", border: "1px solid var(--c-bark)", boxShadow: "var(--glow-shadow)" }}
        >
          <MaintenanceToggle />
          <LanguageToggle />
        </div>
      )}
    </div>
  );
}

/**
 * Mobile navigation — a ⓘ button that opens an accessible full-height drawer.
 * The slim single row could not fit brand + scope + 7 sections + controls on a
 * phone (they overlapped and the center nav was un-tappable). On mobile the
 * sections + the quieter controls live here instead: big tap targets, one
 * section per row, real focus/aria, no overlap. Desktop never renders it.
 */
function MobileMenu({ pathname }: { pathname: string | null }) {
  const [open, setOpen] = useState(false);
  const { t } = useLang();
  // Close on navigation.
  useEffect(() => setOpen(false), [pathname]);
  // Lock body scroll + close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(true)}
        aria-label={t("Menu", "תפריט")}
        aria-expanded={open}
        className="flex items-center justify-center w-9 h-9 rounded-lg"
        style={{ color: "var(--c-fog)", border: "1px solid color-mix(in srgb, var(--c-parchment) 8%, transparent)", background: "var(--surface-warm)" }}
      >
        <i className="ph-light ph-list" style={{ fontSize: "1.25rem" }} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t("Navigation", "ניווט")}>
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setOpen(false)} />
          <div
            className="absolute inset-y-0 end-0 w-[84%] max-w-xs flex flex-col tk-rise"
            style={{ background: "var(--c-soil)", borderInlineStart: "1px solid var(--c-bark)", paddingTop: "env(safe-area-inset-top)" }}
          >
            <div className="flex items-center justify-between px-4 h-14 shrink-0" style={{ borderBottom: "1px solid var(--c-bark)" }}>
              <span className="t-wordmark text-lg">TELOS</span>
              <button
                onClick={() => setOpen(false)}
                aria-label={t("Close", "סגור")}
                className="w-9 h-9 flex items-center justify-center rounded-lg"
                style={{ color: "var(--c-ash)" }}
              >
                <i className="ph-light ph-x" style={{ fontSize: "1.25rem" }} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
              <ul className="flex flex-col gap-1">
                {LINKS.map((l) => {
                  const active = pathname === l.href;
                  return (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className="flex items-center gap-3 px-3 py-3 rounded-xl text-[15px] transition-colors"
                        style={{
                          color: active ? "var(--c-parchment)" : "var(--c-fog)",
                          background: active ? "color-mix(in srgb, var(--c-basil) 15%, transparent)" : "transparent",
                        }}
                      >
                        <i className={"ph-light " + l.icon} style={{ fontSize: "1.35rem", color: active ? "var(--c-basil)" : "var(--c-stone)" }} />
                        {t(l.en, l.he)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 pt-3 flex flex-col gap-2" style={{ borderTop: "1px solid var(--c-bark)" }}>
                <div className="px-1"><AutonomousToggle /></div>
                <MaintenanceToggle />
                <LanguageToggle />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function Nav() {
  const pathname = usePathname();
  const { t } = useLang();
  // The marketing homepage (/site) is standalone — it carries its own chrome.
  if (pathname?.startsWith("/site")) return null;

  return (
    <nav
      className="sticky top-0 z-30"
      // paddingTop carries the nav's own --c-soil up through the iOS safe-area
      // (notch/status bar) in standalone PWA mode — keeping `top-0` so a `top`
      // offset can't leave a wrong-colored gap above it. 0px on desktop/Android.
      style={{
        // Glass chrome — translucent soil over a blur, so content drifts beneath
        // the nav (premium depth). paddingTop carries it through the iOS notch.
        background: "color-mix(in srgb, var(--c-soil) 78%, transparent)",
        backdropFilter: "blur(18px) saturate(1.3)",
        WebkitBackdropFilter: "blur(18px) saturate(1.3)",
        paddingTop: "env(safe-area-inset-top)",
        borderBottom: "1px solid color-mix(in srgb, var(--c-parchment) 8%, transparent)",
      }}
    >
      {/* Responsive top bar. DESKTOP (md+): brand + scope · section icon-nav ·
          controls. MOBILE: brand + scope · status + tasks · ☰ — the sections and
          quieter controls move into the MobileMenu drawer (one slim row was
          unusable on a phone: overlapping items, un-tappable center nav). */}
      <div className="max-w-[var(--page-max)] mx-auto px-3 sm:px-6 h-14 flex items-center gap-2 sm:gap-4">
        {/* brand + scope */}
        <div className="flex items-center gap-2 shrink-0 min-w-0">
          <Link href="/" className="flex items-baseline gap-2 shrink-0" aria-label="TELOS — the Brain">
            <span className="t-wordmark text-base sm:text-lg">TELOS</span>
            <span
              className="hidden lg:inline"
              style={{ fontFamily: "var(--f-display)", fontStyle: "italic", fontWeight: 500, fontSize: ".78rem", color: "var(--c-ash)" }}
            >
              the Brain
            </span>
          </Link>
          <SystemSwitcher />
        </div>

        {/* center — section icon nav. DESKTOP ONLY: on a phone it doesn't fit,
            so the sections move into the MobileMenu drawer instead. */}
        <ul className="hidden md:flex flex-1 items-center justify-center gap-1 overflow-x-auto no-scrollbar">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <li key={l.href} className="shrink-0">
                <Link
                  href={l.href}
                  title={t(l.en, l.he)}
                  aria-label={t(l.en, l.he)}
                  aria-current={active ? "page" : undefined}
                  className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors text-[var(--c-stone)] hover:text-[var(--c-fog)] hover:bg-[color-mix(in_srgb,var(--c-parchment)_7%,transparent)]"
                  style={active ? { color: "var(--c-basil)", background: "color-mix(in srgb, var(--c-basil) 15%, transparent)" } : undefined}
                >
                  <i className={"ph-light " + l.icon} style={{ fontSize: "1.2rem" }} />
                </Link>
              </li>
            );
          })}
        </ul>

        {/* controls. ms-auto pushes them to the end on mobile (no center nav);
            the heavier controls are desktop-only, the rest live in the drawer. */}
        <div className="flex items-center gap-1.5 shrink-0 ms-auto md:ms-0">
          <div className="hidden md:block"><AutonomousToggle /></div>
          <StatusChip />
          <TasksBadge />
          <div className="hidden md:block"><OverflowMenu /></div>
          <MobileMenu pathname={pathname} />
        </div>
      </div>
    </nav>
  );
}
