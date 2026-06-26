"use client";

import { useState } from "react";

export type StackedOption = {
  value: string;
  label: string;
  description?: string;
};

export function StackedQuestion({
  question,
  options,
  multi,
  allowOther,
  onAnswer,
  disabled,
}: {
  question: string;
  options: StackedOption[];
  multi?: boolean;
  /** Append an "אחר…" card that reveals a free-text box, so a grower whose
   *  answer isn't in the list is never trapped. */
  allowOther?: boolean;
  onAnswer: (text: string) => void;
  disabled?: boolean;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [otherActive, setOtherActive] = useState(false);
  const [otherText, setOtherText] = useState("");

  function toggle(v: string) {
    if (disabled) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (multi) {
        if (next.has(v)) next.delete(v);
        else next.add(v);
      } else {
        next.clear();
        next.add(v);
      }
      return next;
    });
    // Single-select: choosing a real option clears the "other" escape.
    if (!multi) setOtherActive(false);
  }

  function pickOther() {
    if (disabled) return;
    // Single-select: "other" is exclusive with the listed options.
    if (!multi) setPicked(new Set());
    setOtherActive(true);
  }

  const canSubmit =
    !disabled && (picked.size > 0 || (otherActive && otherText.trim().length > 0));

  function submit() {
    if (!canSubmit) return;
    // Send the LABELS as the user reply text (Hebrew, natural). Internal
    // values are conveyed to the AI via context — the labels speak for
    // themselves and feel like a real reply in the chat. A free-text "other"
    // answer is appended verbatim so the agent gets exactly what was typed.
    const parts = options.filter((o) => picked.has(o.value)).map((o) => o.label);
    if (otherActive && otherText.trim()) parts.push(otherText.trim());
    if (parts.length === 0) return;
    onAnswer(parts.join(" · "));
  }

  // Brand-themed (matches the rest of the app: warm surfaces, basil-green accent).
  const optionCls = (active: boolean) =>
    `w-full text-right rounded-xl border p-3 transition-colors flex items-start gap-3 ${
      active
        ? "border-[var(--c-basil)] bg-[color-mix(in_srgb,var(--c-basil)_14%,transparent)]"
        : "border-[var(--c-bark)] hover:bg-[var(--c-earth)]"
    } disabled:opacity-50 disabled:cursor-not-allowed`;
  const markCls = (active: boolean) =>
    `mt-0.5 inline-flex items-center justify-center w-4 h-4 ${
      multi ? "rounded-sm" : "rounded-full"
    } border-2 shrink-0 ${
      active
        ? "border-[var(--c-basil)] bg-[var(--c-basil)] text-[var(--c-void)]"
        : "border-[var(--c-stone)]"
    }`;

  return (
    <div className="bg-[var(--surface-warm)] border border-[var(--c-bark)] rounded-2xl p-4 my-2 max-w-md">
      <p className="font-medium text-sm leading-relaxed mb-3 text-[var(--c-parchment)]">{question}</p>
      <ul className="space-y-2">
        {options.map((opt) => {
          const isPicked = picked.has(opt.value);
          return (
            <li key={opt.value}>
              <button type="button" onClick={() => toggle(opt.value)} disabled={disabled} className={optionCls(isPicked)}>
                <span className={markCls(isPicked)}>
                  {isPicked && (
                    <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
                      {multi ? (
                        <path d="M2 6l2.5 2.5L10 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      ) : (
                        <circle cx="6" cy="6" r="2" fill="currentColor" />
                      )}
                    </svg>
                  )}
                </span>
                <div className="flex-1">
                  <div className="text-sm font-medium leading-snug text-[var(--c-parchment)]">{opt.label}</div>
                  {opt.description && (
                    <div className="text-xs text-[var(--c-ash)] mt-1 leading-relaxed">{opt.description}</div>
                  )}
                </div>
              </button>
            </li>
          );
        })}
        {allowOther && (
          <li>
            <button type="button" onClick={pickOther} disabled={disabled} className={optionCls(otherActive)}>
              <span className={markCls(otherActive)}>
                {otherActive && (
                  <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
                    <circle cx="6" cy="6" r="2" fill="currentColor" />
                  </svg>
                )}
              </span>
              <div className="flex-1">
                <div className="text-sm font-medium leading-snug text-[var(--c-parchment)]">אחר — אקליד</div>
              </div>
            </button>
            {otherActive && (
              <textarea
                dir="rtl"
                autoFocus
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                disabled={disabled}
                rows={2}
                placeholder="הקלד/י את התשובה…"
                className="mt-2 w-full text-right text-sm rounded-xl border border-[var(--c-bark)] bg-[var(--ground-warm)] text-[var(--c-parchment)] p-2.5 resize-none focus:outline-none focus:border-[var(--c-basil)] disabled:opacity-50"
              />
            )}
          </li>
        )}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--c-stone)]">
          {multi ? "ניתן לבחור יותר מאחד" : "בחירה אחת"}
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="text-sm font-medium bg-[var(--c-basil)] text-[var(--c-void)] px-4 py-1.5 rounded-lg transition hover:brightness-110 disabled:bg-[var(--c-bark)] disabled:text-[var(--c-stone)] disabled:cursor-not-allowed"
        >
          שלח תשובה
        </button>
      </div>
    </div>
  );
}
