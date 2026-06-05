"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { getActiveSystem } from "@/lib/system";
import { StackedQuestion } from "@/components/StackedQuestion";
import { PendingTasksCard } from "@/components/PendingTasksCard";
import { useLang, statusLabel } from "@/lib/i18n";

// Starters phrased in TELOS voice — short, specific, factual.
// "Always specific.  Day 21, not 'how's it going'."  See brand/voice.ts.
const STARTERS: [string, string][] = [
  ["What's the reading now", "מה הקריאה עכשיו"],
  ["What changed in the last 6 hours", "מה השתנה ב-6 השעות האחרונות"],
  ["Today's dosing breakdown", "פירוט מנות היום"],
  ["Anything to act on", "צריך לפעול במשהו"],
];

type HistoryMessage = {
  id: string;
  ts: string;
  role: "user" | "assistant" | "system";
  parts: Array<Record<string, unknown>>;
  source: "chat" | "cron-cycle" | "cron-poll" | "system" | "reeval";
  decision_id: number | null;
  status: string | null;
};

export default function ChatPage() {
  const { t, lang } = useLang();
  const [activeSystem, setActiveSystemState] = useState<string>("default");
  const [historyLoaded, setHistoryLoaded] = useState(false);
  // Per-system info needed to branch the empty-state UI:
  //  - "fresh placeholder" → just created via SystemSwitcher, never onboarded
  //  - "set up but no chat history yet" → existing system, first chat session
  //  - "set up + has history" → normal recurring session
  const [systemInfo, setSystemInfo] = useState<{
    name: string;
    setup_completed_at: string | null;
  } | null>(null);
  // Map message id → { source, decision_id, status } so we can render
  // cron-pushed messages with the collapsed-card pattern.
  const [messageMeta, setMessageMeta] = useState<
    Record<string, { source: string; decision_id: number | null; status: string | null; ts: string }>
  >({});

  const { messages, sendMessage, setMessages, status, error, regenerate } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: () => ({ system: getActiveSystem() }),
    }),
  });

  // Load history + system metadata once we know which system is active.
  useEffect(() => {
    const sys = getActiveSystem();
    setActiveSystemState(sys);
    let cancelled = false;
    (async () => {
      try {
        const qs = sys && sys !== "default" ? `?system=${encodeURIComponent(sys)}` : "";
        // System metadata in parallel with history — we need it to render the
        // right empty-state (fresh-system CTA vs normal starters).
        const [r, sysRes] = await Promise.all([
          fetch(`/api/chat/history${qs}`, { cache: "no-store" }),
          fetch(`/api/systems/${encodeURIComponent(sys)}`, { cache: "no-store" }).catch(() => null),
        ]);
        if (sysRes && sysRes.ok && !cancelled) {
          try {
            const sj = (await sysRes.json()) as { system?: { name: string; setup_completed_at: string | null } };
            if (sj.system) {
              setSystemInfo({
                name: sj.system.name,
                setup_completed_at: sj.system.setup_completed_at,
              });
            }
          } catch {
            // metadata is non-fatal — empty state will fall back to defaults
          }
        }
        if (!r.ok) throw new Error(`history ${r.status}`);
        const j = (await r.json()) as { messages: HistoryMessage[] };
        if (cancelled) return;
        const meta: Record<string, { source: string; decision_id: number | null; status: string | null; ts: string }> = {};
        for (const m of j.messages) {
          meta[m.id] = {
            source: m.source,
            decision_id: m.decision_id,
            status: m.status,
            ts: m.ts,
          };
        }
        setMessageMeta(meta);
        // Hydrate the chat with persisted messages
        setMessages(
          j.messages.map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant" | "system",
            parts: m.parts as never,
          }))
        );
      } catch (e) {
        console.error("[history] load failed:", e);
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setMessages]);

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const didInitialScrollRef = useRef(false);

  // Initial scroll fix — earlier attempts using scrollHeight inside a
  // single requestAnimationFrame were unreliable: ReactMarkdown inside
  // each message bubble triggers post-paint layout shifts, so the
  // scrollHeight measured one frame after setMessages was usually too
  // small.  The grower would land mid-thread on the first message
  // instead of the last.
  //
  // The robust pattern:
  //  1. Sentinel <div ref={bottomRef} /> sits AFTER the last message.
  //  2. useLayoutEffect (synchronously, post-DOM-mutation) calls
  //     scrollIntoView on it — the browser does the math, no manual
  //     scrollHeight measurement needed.
  //  3. Three rAF retries afterward catch any late-binding layout
  //     shifts (markdown image loads, font metrics swap, etc).
  useLayoutEffect(() => {
    if (didInitialScrollRef.current) return;
    if (!historyLoaded || messages.length === 0) return;
    const jump = () => {
      bottomRef.current?.scrollIntoView({
        block: "end",
        behavior: "instant" as ScrollBehavior,
      });
    };
    jump();
    didInitialScrollRef.current = true;
    // Belt-and-suspenders: if markdown / font swap shifted layout after
    // our first jump, three more frames catch it without the user
    // seeing any in-between state.
    requestAnimationFrame(() => {
      jump();
      requestAnimationFrame(() => {
        jump();
        requestAnimationFrame(jump);
      });
    });
  }, [historyLoaded, messages.length]);

  // Subsequent updates: smooth scroll on new messages or streaming chunks.
  useEffect(() => {
    if (!didInitialScrollRef.current) return; // initial path handled above
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, status]);

  // Attached files (images for now — Claude Sonnet 4.6 has vision input).
  // AI SDK 6's DefaultChatTransport handles the multipart upload + base64
  // serialisation automatically; on the server convertToModelMessages
  // turns the parts into Anthropic image content blocks.
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    // Cap at 4 images per turn to keep the prompt sane.  Show oldest first.
    const next = [...attachedFiles, ...Array.from(list)].slice(0, 4);
    setAttachedFiles(next);
    // Reset the input so the SAME file can be re-selected later after
    // it's been removed from the chip list.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment(idx: number) {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function fileToDataUrl(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(f);
    });
  }

  /**
   * Resize + re-compress an image client-side BEFORE it hits the wire.
   *
   * Why: Vercel serverless functions cap the request body at 4.5MB.  Inline
   * base64 inflates files ~33%, so a couple of phone photos blow past the
   * limit → FUNCTION_PAYLOAD_TOO_LARGE.
   *
   * The hard case is iPhone: photos are HEIC at up to 48MP.  Decoding a
   * 48MP image into an HTMLImageElement + drawing it to a canvas
   * overwhelms iOS Safari's canvas memory budget and fails silently —
   * which previously fell back to the RAW 5MB+ file and re-triggered the
   * payload error.  `createImageBitmap(file, { resizeWidth, resizeHeight })`
   * decodes AND downsamples in a single memory-efficient native step,
   * which iOS handles even for 48MP sources.
   *
   * Returns a JPEG data URL (~150-300KB at 1024px).  Throws if the image
   * genuinely can't be decoded — caller surfaces that to the grower
   * instead of silently shipping a too-large raw file.
   */
  async function compressImage(
    f: File,
    maxEdge = 1024,
    quality = 0.72
  ): Promise<{ url: string; mediaType: string }> {
    // Path 1 — createImageBitmap with native resize (handles 48MP iPhone).
    if (typeof createImageBitmap === "function") {
      try {
        const probe = await createImageBitmap(f);
        const longest = Math.max(probe.width, probe.height);
        const scale = Math.min(1, maxEdge / longest);
        const w = Math.max(1, Math.round(probe.width * scale));
        const h = Math.max(1, Math.round(probe.height * scale));
        probe.close?.();
        const bmp = await createImageBitmap(f, {
          resizeWidth: w,
          resizeHeight: h,
          resizeQuality: "high",
        });
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        ctx.drawImage(bmp, 0, 0);
        bmp.close?.();
        const jpeg = canvas.toDataURL("image/jpeg", quality);
        if (jpeg && jpeg.length > 100) return { url: jpeg, mediaType: "image/jpeg" };
        throw new Error("empty canvas output");
      } catch (e) {
        console.warn("[chat] createImageBitmap path failed, trying <img>:", e);
        // fall through to path 2
      }
    }

    // Path 2 — classic Image + canvas (desktop / older browsers).
    const dataUrl = await fileToDataUrl(f);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image decode failed"));
      el.src = dataUrl;
    });
    const longest = Math.max(img.width, img.height);
    const scale = Math.min(1, maxEdge / longest);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0, w, h);
    const jpeg = canvas.toDataURL("image/jpeg", quality);
    return { url: jpeg, mediaType: "image/jpeg" };
  }

  async function handleSubmit(text?: string) {
    const value = (text ?? input).trim();
    const hasFiles = attachedFiles.length > 0;
    if (!value && !hasFiles) return;
    if (status !== "ready") return;

    let fileParts: Array<{ type: "file"; mediaType: string; url: string; filename?: string }> | undefined;
    if (hasFiles) {
      try {
        fileParts = await Promise.all(
          attachedFiles.map(async (f) => {
            const { url, mediaType } = await compressImage(f);
            return {
              type: "file" as const,
              mediaType,
              url,
              filename: f.name,
            };
          })
        );
        // Guard against the 4.5MB function-payload ceiling.  Sum the
        // base64 payloads; if still over ~4MB (leaving headroom for the
        // rest of the request), bail with a clear message rather than a
        // cryptic FUNCTION_PAYLOAD_TOO_LARGE.
        const totalBytes = fileParts.reduce((sum, p) => sum + p.url.length, 0);
        if (totalBytes > 4_000_000) {
          alert(
            t("The images are still too large even after compression. Try sending fewer or smaller images.", "התמונות עדיין כבדות מדי גם אחרי כיווץ. נסה לשלוח פחות תמונות או תמונות קטנות יותר.")
          );
          return;
        }
      } catch (err) {
        console.error("[chat] file processing failed:", err);
        alert(t("I couldn't process the image. Try again.", "לא הצלחתי לעבד את התמונה. נסה שוב."));
        return;
      }
    }

    sendMessage({
      // If the grower attached only images with no caption, still send a
      // minimal text so the agent has SOMETHING to ground its reply on.
      text: value || "(תמונה מצורפת — תסתכל ותגיד מה אתה רואה)",
      ...(fileParts ? { files: fileParts } : {}),
    });
    setInput("");
    setAttachedFiles([]);
  }

  const isEmpty = historyLoaded && messages.length === 0;
  const isStreaming = status === "submitted" || status === "streaming";
  // A "fresh system" is one that hasn't completed physical setup yet —
  // covers both "just created via SystemSwitcher" and "created but
  // grower closed the tab before onboarding finished".  In that state
  // the generic starters ("the leaves look pale") are nonsense; show
  // a single explicit kickoff CTA instead.
  const isFreshSystem =
    systemInfo !== null &&
    systemInfo.setup_completed_at === null &&
    (systemInfo.name === "מערכת חדשה" || systemInfo.name === "");

  return (
    // Sticky input dock handles its own safe-area padding so main has no
    // bottom padding — otherwise we'd get an empty band below the dock.
    <main className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-3 sm:px-4 pt-4 sm:pt-6 min-h-0">
      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto pb-4 space-y-5 scroll-smooth"
      >
        {isEmpty && isFreshSystem && (
          // Fresh-system empty state — TELOS voice: no welcome flourish,
          // no rocket emoji, no "let's begin your journey".  A position,
          // then a single fact-shaped CTA.
          <div className="text-center pt-16 pb-8" dir={lang === "he" ? "rtl" : "ltr"}>
            <div className="t-eyebrow mb-4">Day 0</div>
            <h1
              className="font-display italic font-light text-3xl sm:text-4xl mb-3 text-[var(--c-parchment)]"
              style={{ fontFamily: lang === "he" ? "var(--f-display-he)" : "var(--f-display)" }}
            >
              {t("New system.", "מערכת חדשה.")}
            </h1>
            <p className="text-[var(--c-ash)] text-sm leading-relaxed max-w-md mx-auto mb-8">
              {t("One pass. Name, crop, volume, fertilizer, channels. TELOS asks. You answer.", "לחיצה אחת. שם, גידול, נפח, דשן, ערוצים. TELOS שואל. אתה עונה.")}
            </p>
            <button
              onClick={() => handleSubmit(t("Let's set up the system", "בוא נתחיל להקים את המערכת"))}
              disabled={isStreaming}
              className="px-6 py-3 rounded-full bg-[var(--c-basil)] hover:brightness-110 text-[var(--c-void)] font-medium text-sm disabled:opacity-50 tracking-wide transition-all"
            >
              {t("Start →", "התחל ←")}
            </button>
          </div>
        )}

        {isEmpty && !isFreshSystem && (
          // Returning-user empty state — TELOS voice: a fact, a question
          // the data could answer, no greeting fluff.  Starters are short,
          // specific, and end without punctuation.
          <div className="text-center pt-16 pb-8" dir={lang === "he" ? "rtl" : "ltr"}>
            <div className="t-eyebrow mb-4">TELOS Farm</div>
            <h1
              className="font-display italic font-light text-3xl sm:text-4xl mb-3 text-[var(--c-parchment)]"
              style={{ fontFamily: lang === "he" ? "var(--f-display-he)" : "var(--f-display)" }}
            >
              {t("I'm here.", "אני כאן.")}
            </h1>
            <p className="text-[var(--c-ash)] text-sm leading-relaxed max-w-md mx-auto">
              {t("Ask. I answer from the data.", "שאל. אענה מהדאטה.")}
            </p>
            <div className="mt-8 grid sm:grid-cols-2 gap-2 max-w-lg mx-auto">
              {STARTERS.map((s) => {
                const label = t(s[0], s[1]);
                return (
                  <button
                    key={s[1]}
                    onClick={() => handleSubmit(label)}
                    className="text-sm p-3 rounded-md border border-[rgba(238,237,232,0.12)] bg-[var(--c-soil)] hover:bg-[var(--c-earth)] hover:border-[rgba(137,168,62,0.25)] text-[var(--c-fog)] transition-colors"
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!historyLoaded && (
          <div className="text-center text-[var(--c-ash)] text-sm pt-12">{t("Loading history…", "טוען היסטוריה...")}</div>
        )}

        {messages.map((m, idx) => {
          const isLast = idx === messages.length - 1;
          const isAssistant = m.role === "assistant";
          const meta = messageMeta[m.id];
          return (
            <MessageBubble
              key={m.id}
              message={m}
              meta={meta}
              isLastAssistant={isLast && isAssistant}
              awaitingAnswer={!isStreaming}
              onAnswer={(text) => handleSubmit(text)}
            />
          );
        })}

        {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex items-center gap-2 text-[var(--c-ash)] text-sm">
            <Spinner /> {t("Thinking…", "חושב...")}
          </div>
        )}

        {error && (
          <div
            className="text-sm p-3 rounded-lg flex items-start justify-between gap-3"
            style={{ background: "color-mix(in srgb, var(--c-terra) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--c-terra) 30%, transparent)", color: "var(--c-fog)" }}
          >
            <div className="break-words">{t("Something went wrong. Try again.", "משהו השתבש. נסה שוב.")}</div>
            <button
              onClick={() => regenerate()}
              className="text-xs px-2 py-1 rounded shrink-0"
              style={{ background: "color-mix(in srgb, var(--c-terra) 18%, transparent)", color: "var(--c-parchment)" }}
            >
              {t("Retry", "נסה שוב")}
            </button>
          </div>
        )}

        {/* Scroll sentinel — useLayoutEffect calls scrollIntoView() on
            this element to land the grower at the bottom of the thread
            on initial paint, and on every subsequent message change. */}
        <div ref={bottomRef} aria-hidden="true" />
      </div>

      {/* Input dock — sticky to the bottom of the viewport with an opaque
          background so messages scroll BEHIND it (and via the
          scroll-sentinel above, never under it on first paint).  The
          dock contains the pending-tasks widget + any attachment chips
          + the input row, all glued together so the grower's primary
          interaction surface is always reachable. */}
      <div
        className="sticky bottom-0 z-20 bg-[var(--c-void)] -mx-3 sm:-mx-4 px-3 sm:px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      >
        {/* Pending tasks card sits inside the dock so it shares the
            opaque background — otherwise messages would be visible
            through it when there's a pending task. */}
        <PendingTasksCard />

        {/* Attachment preview row — chips with thumbnails + remove ×.
            Only renders when there's at least one selected file. */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 pb-2 pt-1">
            {attachedFiles.map((f, idx) => {
              const url = URL.createObjectURL(f);
              return (
                <div
                  key={`${f.name}-${idx}`}
                  className="relative group rounded-sm overflow-hidden border border-[rgba(238,237,232,0.12)] bg-[var(--c-soil)]"
                  style={{ width: 64, height: 64 }}
                >
                  {/* Using a plain img tag — we need an in-memory blob URL
                      for unsubmitted files; next/image needs a remote URL. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={f.name}
                    className="object-cover w-full h-full"
                    onLoad={() => URL.revokeObjectURL(url)}
                  />
                  <button
                    type="button"
                    onClick={() => removeAttachment(idx)}
                    className="absolute top-0.5 end-0.5 w-5 h-5 rounded-full bg-[var(--c-void)]/85 text-[var(--c-parchment)] text-xs leading-none flex items-center justify-center hover:bg-[var(--c-terra)] transition-colors"
                    aria-label={`הסר ${f.name}`}
                    title={f.name}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="border-t border-[rgba(238,237,232,0.07)] pt-3 flex items-end gap-2"
        >
          {/* Hidden file input — opened by the attach button.  accept=
              "image/*" so the OS picker shows camera + photo library on
              mobile, file browser on desktop. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={onPickFiles}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming || attachedFiles.length >= 4}
            title={
              attachedFiles.length >= 4
                ? t("Max 4 images per message", "מקסימום 4 תמונות בהודעה")
                : t("Attach image", "צרף תמונה")
            }
            aria-label={t("Attach image", "צרף תמונה")}
            className="shrink-0 w-10 h-10 rounded-md border border-[rgba(238,237,232,0.12)] bg-[var(--c-soil)] hover:bg-[var(--c-earth)] hover:border-[rgba(137,168,62,0.25)] text-[var(--c-fog)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
          >
            {/* Paperclip glyph — inline SVG so we don't pull an icon lib */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            rows={1}
            placeholder={t("Write a message…", "כתוב הודעה...")}
            disabled={isStreaming}
            className="flex-1 resize-none bg-[var(--c-soil)] border border-[rgba(238,237,232,0.07)] text-[var(--c-parchment)] placeholder:text-[var(--c-stone)] rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[rgba(137,168,62,0.45)] focus:ring-1 focus:ring-[rgba(137,168,62,0.25)] disabled:opacity-50"
            style={{ minHeight: 40, maxHeight: 160 }}
          />
          <button
            type="submit"
            disabled={(!input.trim() && attachedFiles.length === 0) || isStreaming}
            className="px-4 py-2 rounded-full bg-[var(--c-basil)] hover:brightness-110 text-[var(--c-void)] text-sm font-medium disabled:bg-[var(--c-bark)] disabled:text-[var(--c-stone)] disabled:cursor-not-allowed min-h-[40px] sm:min-h-0 tracking-wide transition-all"
          >
            {t("Send", "שלח")}
          </button>
        </form>
      </div>
    </main>
  );
}

type UIMessageType = ReturnType<typeof useChat>["messages"][number];

const STATUS_COLOR: Record<string, string> = {
  healthy: "var(--c-basil)",
  attention: "var(--c-terra)",
  warning: "var(--c-terra)",
  critical: "var(--c-terra)",
};

function MessageBubble({
  message,
  meta,
  isLastAssistant,
  onAnswer,
  awaitingAnswer,
}: {
  message: UIMessageType;
  meta?: { source: string; decision_id: number | null; status: string | null; ts: string };
  isLastAssistant: boolean;
  onAnswer: (text: string) => void;
  awaitingAnswer: boolean;
}) {
  const { t } = useLang();
  const isUser = message.role === "user";
  // Brain-pushed messages (scheduled cron OR a grower-action re-eval) render as
  // collapsible log cards rather than plain chat bubbles.
  const isCronPushed =
    meta?.source === "cron-cycle" ||
    meta?.source === "cron-poll" ||
    meta?.source === "reeval";

  // Cron-pushed assistant messages render as a compact, collapsible "log card"
  // — the agronomist's quiet check-ins or active interventions. Keeps the chat
  // scannable instead of an information firehose.
  if (!isUser && isCronPushed) {
    const status = meta?.status || "unknown";
    const time = meta?.ts ? new Date(meta.ts) : null;
    const textPart = message.parts.find((p) => p.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    return (
      <details className="tk-card rounded-xl overflow-hidden max-w-full" style={{ padding: 0, background: "var(--surface-warm)" }} open={isLastAssistant}>
        <summary className="cursor-pointer px-4 py-3 list-none flex items-start gap-3">
          <i className="ph-light ph-pulse text-lg mt-0.5" style={{ color: "var(--amber)" }} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-xs mb-1 flex-wrap" style={{ color: "var(--c-ash)" }}>
              <span style={{ fontWeight: 500, color: "var(--c-fog)" }}>{t("Auto check-in", "בדיקה אוטומטית")}</span>
              {["healthy", "attention", "warning", "critical"].includes(status) && (
                <span
                  className="px-2 py-0.5 rounded-full text-xs"
                  style={{
                    color: STATUS_COLOR[status] ?? "var(--c-ash)",
                    background: `color-mix(in srgb, ${STATUS_COLOR[status] ?? "var(--c-stone)"} 16%, transparent)`,
                  }}
                >
                  {statusLabel(status, t)}
                </span>
              )}
              {time && (
                <span style={{ color: "var(--c-stone)" }} dir="ltr">
                  {time.toLocaleString("he-IL", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                </span>
              )}
            </div>
            {textPart?.text && (
              <p className="text-sm leading-relaxed line-clamp-3" style={{ color: "var(--c-fog)" }}>{textPart.text}</p>
            )}
          </div>
          <span style={{ color: "var(--c-stone)" }} className="text-sm">▾</span>
        </summary>
        <div className="px-4 pb-4 pt-3 space-y-3 text-sm" style={{ borderTop: "1px solid color-mix(in srgb, var(--c-parchment) 7%, transparent)" }}>
          {textPart?.text && (
            <div className="prose-chat">
              <ReactMarkdown>{textPart.text}</ReactMarkdown>
            </div>
          )}
          {message.parts
            .filter((p) => typeof p.type === "string" && (p.type as string).startsWith("tool-"))
            .map((p, i) => (
              <ToolPart key={i} part={p as { type: string } & Record<string, unknown>} />
            ))}
          {meta?.decision_id && (
            <div className="text-xs text-[var(--c-ash)]" dir="ltr">
              decision #{meta.decision_id}
            </div>
          )}
        </div>
      </details>
    );
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] ${isUser ? "rounded-2xl rounded-bl-md px-4 py-2" : "leading-relaxed"}`}
        style={
          isUser
            ? {
                background: "color-mix(in srgb, var(--c-basil) 14%, transparent)",
                border: "1px solid color-mix(in srgb, var(--c-basil) 30%, transparent)",
                color: "var(--c-parchment)",
              }
            : { color: "var(--c-fog)" }
        }
      >
        {message.parts.map((part, i) => {
          // File parts (images the grower attached, or images TELOS sends
          // back — though right now only the inbound direction exists).
          // AI SDK v6 part shape: { type: 'file', mediaType, url, filename? }.
          // The url is either a data: URL (inline base64) or an https URL.
          if (part.type === "file") {
            const file = part as {
              type: "file";
              mediaType?: string;
              url?: string;
              filename?: string;
            };
            const isImage = (file.mediaType ?? "").startsWith("image/");
            if (!file.url) return null;
            if (isImage) {
              return (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={file.url}
                  alt={file.filename ?? "attached image"}
                  className="block max-w-full sm:max-w-xs rounded-md border border-[rgba(238,237,232,0.12)] mb-2"
                  loading="lazy"
                />
              );
            }
            // Non-image attachment fallback — a link chip.
            return (
              <a
                key={i}
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-xs px-2 py-1 rounded-sm border border-[rgba(238,237,232,0.12)] bg-[var(--c-soil)] text-[var(--c-fog)] hover:border-[rgba(137,168,62,0.25)] mb-2"
              >
                {file.filename ?? t("attachment", "קובץ מצורף")}
              </a>
            );
          }
          if (part.type === "text") {
            if (isUser) {
              return (
                <p key={i} className="whitespace-pre-wrap text-sm">
                  {part.text}
                </p>
              );
            }
            return (
              <div key={i} className="text-sm prose-chat">
                <ReactMarkdown>{part.text}</ReactMarkdown>
              </div>
            );
          }
          if (part.type === "reasoning") {
            return (
              <details
                key={i}
                className="text-xs text-[var(--c-stone)] mt-2 mb-1"
              >
                <summary className="cursor-pointer">{t("Reasoning", "תהליך מחשבה")}</summary>
                <p className="mt-1 leading-relaxed" dir="ltr">
                  {("text" in part && (part as { text?: string }).text) || ""}
                </p>
              </details>
            );
          }
          if (typeof part.type === "string" && part.type.startsWith("tool-")) {
            const toolName = part.type.replace(/^tool-/, "");
            // askGrower renders as a stacked-question card the user can click.
            // Active only on the latest assistant message so old questions
            // don't re-trigger.
            if (toolName === "askGrower") {
              const input = (part as { input?: { question?: string; options?: Array<{ value: string; label: string; description?: string }>; multi?: boolean } }).input;
              if (input?.question && input?.options && input.options.length > 0) {
                return (
                  <StackedQuestion
                    key={i}
                    question={input.question}
                    options={input.options}
                    multi={input.multi}
                    onAnswer={onAnswer}
                    disabled={!isLastAssistant || !awaitingAnswer}
                  />
                );
              }
              // Free-text question (no options) → just show the question; the
              // grower types in the regular input box.
              return input?.question ? (
                <div
                  key={i}
                  className="bg-[var(--surface-warm)] border border-[rgba(238,237,232,0.08)] rounded-2xl p-4 my-2 max-w-md"
                >
                  <p className="font-medium text-sm leading-relaxed">{input.question}</p>
                  <p className="text-xs text-[var(--c-ash)] mt-2">{t("Reply below in the message box ↓", "ענה למטה בתיבת ההודעות ↓")}</p>
                </div>
              ) : null;
            }
            // updateSystem is a silent side-effect — don't render a card.
            if (toolName === "updateSystem") {
              return null;
            }
            return <ToolPart key={i} part={part as { type: string } & Record<string, unknown>} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}

function ToolPart({ part }: { part: { type: string } & Record<string, unknown> }) {
  const { t } = useLang();
  const toolName = part.type.replace(/^tool-/, "");
  const state = (part as { state?: string }).state;

  // Friendly, agronomist-framed activity labels. We deliberately do NOT render
  // the raw tool input/output JSON or fall back to the internal function name —
  // that would leak how TELOS works under the hood (proprietary).
  const labels: Record<string, [string, string]> = {
    getCurrentState: ["📡 Checking the current state", "📡 בודק מצב נוכחי"],
    getRecentReadings: ["📈 Pulling sensor history", "📈 שולף היסטוריית חיישן"],
    getRecentDecisions: ["📋 Reviewing recent decisions", "📋 בודק החלטות אחרונות"],
    getPendingTasks: ["✅ Checking open tasks", "✅ בודק משימות פתוחות"],
    proposeAction: ["💧 Proposing an action", "💧 מציע פעולה"],
    requestObservation: ["📷 Requesting a check", "📷 מבקש תצפית"],
  };
  const label = labels[toolName] ? t(...labels[toolName]) : t("⚙️ Working…", "⚙️ עובד…");

  return (
    <div className="my-2 text-xs bg-[var(--surface-warm)] rounded-lg overflow-hidden border border-[rgba(238,237,232,0.08)]">
      <div className="px-3 py-2 flex items-center gap-2">
        <span>{label}</span>
        {state === "input-streaming" || state === "input-available" ? <Spinner /> : null}
        {state === "output-error" && (
          <span style={{ color: "var(--c-terra)" }}>{t("error", "שגיאה")}</span>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span className="inline-block w-3 h-3 border-2 border-[var(--c-bark)] border-t-[var(--c-basil)] rounded-full animate-spin" />
  );
}
