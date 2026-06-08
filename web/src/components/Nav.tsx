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
  { href: "/chat", en: "Chat", he: "שיחה", icon: "ph-chat-circle" },
  { href: "/decisions", en: "Decisions", he: "החלטות", icon: "ph-list-checks" },
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
      style={{ background: "var(--c-soil)", paddingTop: "env(safe-area-inset-top)", borderBottom: "1px solid color-mix(in srgb, var(--c-parchment) 6%, transparent)" }}
    >
      <div className="max-w-6xl mx-auto px-3 sm:px-6 pt-2 pb-2 flex flex-col gap-2">
        {/* Row 1 — brand + scope (start) · status + overflow (end) */}
        <div className="flex items-center justify-between gap-3 min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/" className="flex items-baseline gap-2 shrink-0" aria-label="TELOS — the Brain">
              <span className="t-wordmark text-base sm:text-lg">TELOS</span>
              <span
                className="hidden sm:inline"
                style={{ fontFamily: "var(--f-display)", fontStyle: "italic", fontWeight: 500, fontSize: ".8rem", color: "var(--c-ash)" }}
              >
                the Brain
              </span>
            </Link>
            {/* scope selector — adjacent to the logo */}
            <SystemSwitcher />
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <AutonomousToggle />
            <StatusChip />
            <TasksBadge />
            <OverflowMenu />
          </div>
        </div>

        {/* Row 2 — the section nav, a centered floating segmented control */}
        <div className="flex justify-center">
          <ul
            className="flex items-center gap-0.5 p-1 rounded-full max-w-full overflow-x-auto no-scrollbar"
            style={{ background: "var(--ground-warm)", border: "1px solid color-mix(in srgb, var(--c-parchment) 7%, transparent)", boxShadow: "var(--glow-shadow)" }}
          >
            {LINKS.map((l) => {
              const active = pathname === l.href;
              return (
                <li key={l.href} className="shrink-0">
                  <Link
                    href={l.href}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] sm:text-sm whitespace-nowrap transition-colors"
                    style={{
                      color: active ? "var(--c-parchment)" : "var(--c-ash)",
                      background: active ? "color-mix(in srgb, var(--c-basil) 16%, transparent)" : "transparent",
                    }}
                  >
                    <i
                      className={"ph-light " + l.icon}
                      style={{ fontSize: "1.05rem", color: active ? "var(--c-basil)" : "var(--c-stone)" }}
                    />
                    {t(l.en, l.he)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </nav>
  );
}
