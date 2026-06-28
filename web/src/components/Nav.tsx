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

/** Overflow (⋯) menu — holds the quieter controls (maintenance, language, and
 *  on mobile the autonomous toggle, which isn't in the slim mobile header). */
function OverflowMenu({ includeAutonomous = false }: { includeAutonomous?: boolean }) {
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
          className="absolute start-0 md:start-auto md:end-0 mt-2 w-56 rounded-lg overflow-hidden z-50"
          style={{ background: "var(--surface-warm)", border: "1px solid var(--c-bark)", boxShadow: "var(--glow-shadow)" }}
        >
          {includeAutonomous && (
            <div className="p-2" style={{ borderBottom: "1px solid var(--c-bark)" }}>
              <AutonomousToggle />
            </div>
          )}
          <MaintenanceToggle />
          <LanguageToggle />
        </div>
      )}
    </div>
  );
}

/** The section tabs, Facebook-style: a full-width row of icon tabs, the active
 *  one marked with a basil icon + underline. Used on mobile (its own dedicated
 *  row, so all 7 fit) and shared shape with the desktop center nav. */
function SectionTabs({ pathname }: { pathname: string | null }) {
  const { t } = useLang();
  return (
    <ul
      className="flex items-stretch overflow-x-auto no-scrollbar"
      style={{ borderTop: "1px solid color-mix(in srgb, var(--c-parchment) 8%, transparent)" }}
    >
      {LINKS.map((l) => {
        const active = pathname === l.href;
        return (
          <li key={l.href} className="flex-1 min-w-[44px]">
            <Link
              href={l.href}
              title={t(l.en, l.he)}
              aria-label={t(l.en, l.he)}
              aria-current={active ? "page" : undefined}
              className="relative flex items-center justify-center h-12 transition-colors"
              style={{ color: active ? "var(--c-basil)" : "var(--c-stone)" }}
            >
              <i className={"ph-light " + l.icon} style={{ fontSize: "1.35rem" }} />
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 inset-x-3 h-[2.5px] rounded-full"
                  style={{ background: "var(--c-basil)" }}
                />
              )}
            </Link>
          </li>
        );
      })}
    </ul>
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
      style={{
        // Glass chrome — translucent soil over a blur, so content drifts beneath
        // the nav (premium depth). paddingTop carries it through the iOS notch.
        background: "color-mix(in srgb, var(--c-soil) 82%, transparent)",
        backdropFilter: "blur(18px) saturate(1.3)",
        WebkitBackdropFilter: "blur(18px) saturate(1.3)",
        paddingTop: "env(safe-area-inset-top)",
        borderBottom: "1px solid color-mix(in srgb, var(--c-parchment) 8%, transparent)",
      }}
    >
      {/* DESKTOP (md+) — one slim row: brand + scope · section icon-nav · controls. */}
      <div className="hidden md:flex max-w-[var(--page-max)] mx-auto px-6 h-14 items-center gap-4">
        <div className="flex items-center gap-2 shrink-0 min-w-0">
          <Link href="/" className="flex items-baseline gap-2 shrink-0" aria-label="TELOS — the Brain">
            <span className="t-wordmark text-lg">TELOS</span>
            <span
              className="hidden lg:inline"
              style={{ fontFamily: "var(--f-display)", fontStyle: "italic", fontWeight: 500, fontSize: ".78rem", color: "var(--c-ash)" }}
            >
              the Brain
            </span>
          </Link>
          <SystemSwitcher />
        </div>
        <ul className="flex-1 flex items-center justify-center gap-1 overflow-x-auto no-scrollbar">
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
        <div className="flex items-center gap-1.5 shrink-0">
          <AutonomousToggle />
          <StatusChip />
          <TasksBadge />
          <OverflowMenu />
        </div>
      </div>

      {/* MOBILE (< md) — an app-like header: a centered TELOS logo with the
          active system's name beneath it (tap → switch system), quiet controls
          in the corners, and a Facebook-style icon tab row for the sections. */}
      <div className="md:hidden">
        <div className="relative flex flex-col items-center justify-center gap-1 pt-2 pb-1.5 px-2">
          <div className="absolute start-2 top-2">
            <OverflowMenu includeAutonomous />
          </div>
          <div className="absolute end-2 top-2 flex items-center gap-1.5">
            <StatusChip />
            <TasksBadge />
          </div>
          <Link href="/" aria-label="TELOS">
            <span className="t-wordmark text-lg">TELOS</span>
          </Link>
          <SystemSwitcher />
        </div>
        <SectionTabs pathname={pathname} />
      </div>
    </nav>
  );
}
