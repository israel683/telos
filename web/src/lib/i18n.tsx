"use client";

/**
 * Lightweight i18n for the TELOS app.
 *
 * Default language is ENGLISH; the grower can switch to Hebrew (persisted in
 * localStorage). Language drives <html lang> + dir (en → ltr, he → rtl) so the
 * RTL mirroring the app was built with still works when Hebrew is chosen.
 *
 * Strings are translated inline with `t("English", "עברית")` — no key files to
 * maintain. Wrap a string as you touch it; until wrapped it stays as-authored.
 */

import { createContext, useContext, useEffect, useState, useCallback } from "react";

export type Lang = "en" | "he";
const STORAGE_KEY = "telos-lang";
const DEFAULT_LANG: Lang = "en";

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** t(english, hebrew) → the string for the active language. */
  t: (en: string, he: string) => string;
};

const LangContext = createContext<Ctx | null>(null);

function applyToDocument(lang: Lang) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.lang = lang;
  el.dir = lang === "he" ? "rtl" : "ltr";
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  // On mount, adopt the stored preference (default EN). Runs once; the static
  // <html> already ships EN/ltr, so HE users get a one-frame correction.
  useEffect(() => {
    let stored: Lang = DEFAULT_LANG;
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "en" || v === "he") stored = v;
    } catch {
      /* ignore */
    }
    setLangState(stored);
    applyToDocument(stored);
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    applyToDocument(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback((en: string, he: string) => (lang === "he" ? he : en), [lang]);

  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

export function useLang(): Ctx {
  const ctx = useContext(LangContext);
  // Safe fallback if a component renders outside the provider (e.g. tests):
  if (!ctx) {
    return { lang: DEFAULT_LANG, setLang: () => {}, t: (en) => en };
  }
  return ctx;
}
