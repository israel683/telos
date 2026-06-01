"use client";

import { useLang, type Lang } from "@/lib/i18n";

/** Language picker — a row of two options for the nav overflow menu. */
export function LanguageToggle() {
  const { lang, setLang, t } = useLang();
  const opts: { id: Lang; label: string }[] = [
    { id: "en", label: "English" },
    { id: "he", label: "עברית" },
  ];
  return (
    <div className="px-3 py-2" style={{ borderTop: "1px solid var(--c-bark)" }}>
      <div className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: "var(--c-stone)" }}>
        {t("Language", "שפה")}
      </div>
      <div className="flex gap-1.5">
        {opts.map((o) => {
          const active = lang === o.id;
          return (
            <button
              key={o.id}
              onClick={() => setLang(o.id)}
              className="flex-1 text-xs py-1.5 rounded-md transition-colors"
              style={{
                color: active ? "var(--c-parchment)" : "var(--c-ash)",
                background: active ? "color-mix(in srgb, var(--c-basil) 16%, transparent)" : "transparent",
                border: active
                  ? "1px solid color-mix(in srgb, var(--c-basil) 35%, transparent)"
                  : "1px solid var(--c-bark)",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
