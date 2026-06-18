"use client";

import { CULTIVARS, cultivarFull } from "@/lib/cultivar-images";
import { useLang } from "@/lib/i18n";

export default function CultivarsPage() {
  const { t, lang } = useLang();
  const dir = lang === "he" ? "rtl" : "ltr";

  return (
    <div
      dir={dir}
      style={{ maxWidth: 1180, margin: "0 auto", padding: "clamp(1.8rem,4vw,3rem) clamp(0.9rem,3vw,1.6rem) 5rem", display: "flex", flexDirection: "column", gap: "clamp(22px,3vw,38px)" }}
    >
      <header style={{ maxWidth: "44ch" }}>
        <div className="t-eyebrow">{t("Network knowledge", "ידע הרשת")}</div>
        <h1 style={{ fontFamily: "var(--f-display)", fontWeight: 300, fontSize: "clamp(2.6rem,5vw,4.2rem)", lineHeight: 1.04, color: "var(--c-parchment)", margin: "10px 0 0", letterSpacing: "-.01em" }}>
          {t("The cultivar canon", "מאגר הקולטיברים")}
        </h1>
        <p style={{ fontFamily: "var(--f-display)", fontStyle: "italic", fontWeight: 300, fontSize: "clamp(1.15rem,1.7vw,1.45rem)", color: "var(--c-fog)", lineHeight: 1.5, marginTop: 16 }}>
          {t(
            "Every cultivar TELOS grows — its provenance, its character, the protocol behind it.",
            "כל קולטיבר ש‑TELOS מגדל — המקור, האופי, והפרוטוקול שמאחוריו.",
          )}
        </p>
      </header>

      <div className="tk-cult-grid">
        {CULTIVARS.map((c) => (
          <article key={c.slug} className="tk-cult">
            {/* eslint-disable-next-line @next/next/no-img-element -- cinematic cultivar render, pre-optimized webp */}
            <img src={cultivarFull(c.slug)} alt={c.name} loading="lazy" decoding="async" />
            <div className="scrim" />
            {c.cultivar_id ? (
              <span className="coded tk-annotation" style={{ padding: "4px 10px" }}>
                <span className="dot" />
                {t("Protocol", "פרוטוקול")}
              </span>
            ) : null}
            <div className="meta">
              <div className="nm"><bdi>{c.name}</bdi></div>
              <div className="sub">
                <bdi>{t(...c.crop)}{c.provenance ? ` · ${c.provenance}` : ""}</bdi>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
