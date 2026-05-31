"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SystemSwitcher } from "./SystemSwitcher";
import { StatusChip } from "./StatusChip";
import { MaintenanceToggle } from "./MaintenanceToggle";
import { TasksBadge } from "./TasksBadge";
import { AutonomousToggle } from "./AutonomousToggle";

const LINKS = [
  { href: "/", label: "שיחה" },
  { href: "/state", label: "מצב" },
  { href: "/grow", label: "הגידול" },
  { href: "/decisions", label: "החלטות" },
  { href: "/architecture", label: "ארכיטקטורה" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-[rgba(238,237,232,0.07)] bg-[rgba(12,12,10,0.85)] backdrop-blur sticky top-0 z-30">
      {/* Two visual rows on mobile, one row on sm+.  Row 1 = brand + page
          links; row 2 = status widgets.  On phones this stops the nav
          from collapsing chaotically when 9 items try to share one row. */}
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-1.5 sm:py-2 space-y-1.5 sm:space-y-0 sm:flex sm:items-center sm:gap-4">
        {/* Row 1 — TELOS wordmark in Cormorant 300 + 0.22em tracking,
            per the brand kit's logotype spec. */}
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <Link
            href="/"
            className="t-wordmark text-base sm:text-lg shrink-0"
            aria-label="TELOS"
          >
            TELOS
          </Link>
          <ul className="flex gap-1.5 sm:gap-3 text-[13px] sm:text-sm min-w-0 overflow-x-auto -mx-1 px-1 no-scrollbar">
            {LINKS.map((l) => {
              const active = pathname === l.href;
              return (
                <li key={l.href} className="shrink-0">
                  <Link
                    href={l.href}
                    className={`px-1.5 py-1.5 border-b transition-colors whitespace-nowrap tracking-wide ${
                      active
                        ? "border-[var(--c-basil)] text-[var(--c-parchment)]"
                        : "border-transparent text-[var(--c-stone)] hover:text-[var(--c-fog)]"
                    }`}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
        {/* Row 2 (widgets) — wraps if it has to, but starts on its own line
            on mobile so it never fights the links for space. */}
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
