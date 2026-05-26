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
  { href: "/decisions", label: "החלטות" },
  { href: "/architecture", label: "ארכיטקטורה" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/70 backdrop-blur sticky top-0 z-30">
      {/* Two visual rows on mobile, one row on sm+.  Row 1 = brand + page
          links; row 2 = status widgets.  On phones this stops the nav
          from collapsing chaotically when 9 items try to share one row. */}
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-1.5 sm:py-2 space-y-1.5 sm:space-y-0 sm:flex sm:items-center sm:gap-4">
        {/* Row 1 */}
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <Link href="/" className="font-bold text-base shrink-0">
            Telos
          </Link>
          <ul className="flex gap-1.5 sm:gap-3 text-[13px] sm:text-sm min-w-0 overflow-x-auto -mx-1 px-1 no-scrollbar">
            {LINKS.map((l) => {
              const active = pathname === l.href;
              return (
                <li key={l.href} className="shrink-0">
                  <Link
                    href={l.href}
                    className={`px-1.5 py-1.5 border-b-2 transition-colors whitespace-nowrap ${
                      active
                        ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                        : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
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
