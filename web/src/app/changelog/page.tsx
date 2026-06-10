"use client";

import { CHANGELOG, CHANGELOG_CATEGORY } from "@/lib/changelog";
import { useLang } from "@/lib/i18n";

export default function ChangelogPage() {
  const { t, lang } = useLang();
  const dir = lang === "he" ? "rtl" : "ltr";

  return (
    <div
      dir={dir}
      style={{ maxWidth: 760, margin: "0 auto", padding: "1.6rem clamp(0.9rem,3vw,1.6rem) 4rem", display: "flex", flexDirection: "column", gap: 16 }}
    >
      <header>
        <h1 style={{ fontFamily: "var(--f-display)", fontWeight: 500, fontSize: "1.7rem", color: "var(--c-parchment)" }}>
          {t("Change Log", "עדכונים")}
        </h1>
        <p style={{ fontSize: ".88rem", color: "var(--c-ash)", marginTop: 4 }}>
          {t(
            "How TELOS has grown — the capabilities it has gained over time, newest first.",
            "איך TELOS התפתח — היכולות שנוספו לאורך הזמן, מהחדש לישן.",
          )}
        </p>
      </header>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {CHANGELOG.map((entry, i) => {
          const cat = CHANGELOG_CATEGORY[entry.category];
          const last = i === CHANGELOG.length - 1;
          return (
            <div key={entry.id} style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
              {/* Timeline rail: node + connecting line */}
              <div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "center", width: 34 }}>
                <span
                  style={{
                    flex: "none",
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    background: `color-mix(in srgb, ${cat.color} 16%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${cat.color} 40%, transparent)`,
                  }}
                >
                  <i className={"ph-light " + entry.icon} style={{ color: cat.color, fontSize: "1.05rem" }} />
                </span>
                {!last ? (
                  <span style={{ flex: 1, width: 1, minHeight: 14, background: "color-mix(in srgb, var(--c-parchment) 10%, transparent)" }} />
                ) : null}
              </div>

              {/* Card */}
              <section className="tk-card" style={{ padding: "14px 18px", marginBottom: 14, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <b style={{ fontSize: "1rem", color: "var(--c-parchment)" }}>
                    <bdi>{t(...entry.title)}</bdi>
                  </b>
                  <span
                    className="tk-tag"
                    style={{ color: cat.color, background: `color-mix(in srgb, ${cat.color} 14%, transparent)`, fontSize: ".58rem" }}
                  >
                    {t(...cat.label)}
                  </span>
                </div>
                <p style={{ fontSize: ".88rem", color: "var(--c-fog)", marginTop: 5, lineHeight: 1.5 }}>
                  <bdi>{t(...entry.what)}</bdi>
                </p>
                <p style={{ fontSize: ".84rem", color: "var(--c-ash)", marginTop: 4, lineHeight: 1.5 }}>
                  <span style={{ color: "var(--c-stone)" }}>{t("Why it helps", "התועלת")}: </span>
                  <bdi>{t(...entry.benefit)}</bdi>
                </p>
              </section>
            </div>
          );
        })}
      </div>
    </div>
  );
}
