"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SystemSwitcher } from "./SystemSwitcher";
import { StatusChip } from "./StatusChip";
import { MaintenanceToggle } from "./MaintenanceToggle";
import { TasksBadge } from "./TasksBadge";
import { AutonomousToggle } from "./AutonomousToggle";

const LINKS = [
  { href: "/", label: "שיחה", icon: "ph-chat-circle" },
  { href: "/state", label: "מצב", icon: "ph-squares-four" },
  { href: "/grow", label: "הגידול", icon: "ph-plant" },
  { href: "/decisions", label: "החלטות", icon: "ph-list-checks" },
  { href: "/architecture", label: "ארכיטקטורה", icon: "ph-tree-structure" },
];

export function Nav() {
  const pathname = usePathname();
  // The marketing homepage (/site) is standalone — it carries its own chrome.
  if (pathname?.startsWith("/site")) return null;

  return (
    <nav
      className="sticky top-0 z-30"
      style={{
        background: "var(--c-soil)",
        borderBottom: "1px solid color-mix(in srgb, var(--c-parchment) 6%, transparent)",
      }}
    >
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-1.5 sm:py-2 space-y-1.5 sm:space-y-0 sm:flex sm:items-center sm:gap-5">
        {/* brand + page links */}
        <div className="flex items-center gap-3 sm:gap-5 min-w-0">
          {/* the masthead mark — wordmark + "the Brain" italic, the editorial signature */}
          <Link href="/" className="flex items-baseline gap-2 shrink-0" aria-label="TELOS — the Brain">
            <span className="t-wordmark text-base sm:text-lg">TELOS</span>
            <span
              style={{
                fontFamily: "var(--f-display)",
                fontStyle: "italic",
                fontWeight: 500,
                fontSize: ".8rem",
                color: "var(--c-stone)",
              }}
            >
              the Brain
            </span>
          </Link>
          <ul className="flex gap-1 sm:gap-2.5 text-[13px] sm:text-sm min-w-0 overflow-x-auto -mx-1 px-1 no-scrollbar">
            {LINKS.map((l) => {
              const active = pathname === l.href;
              return (
                <li key={l.href} className="shrink-0">
                  <Link
                    href={l.href}
                    className="flex items-center gap-1.5 px-1.5 py-2 whitespace-nowrap transition-colors"
                    style={{ color: active ? "var(--c-parchment)" : "var(--c-stone)" }}
                  >
                    <i
                      className={"ph-light " + l.icon}
                      style={{ fontSize: "1.05rem", color: active ? "var(--c-basil)" : "inherit" }}
                    />
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
        {/* status widgets */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap sm:ms-auto">
          <TasksBadge />
          <AutonomousToggle />
          <StatusChip />
          <MaintenanceToggle />
          <SystemSwitcher />
        </div>
      </div>
    </nav>
  );
}
