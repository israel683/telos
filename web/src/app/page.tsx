"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { getActiveSystem } from "@/lib/system";
import { StackedQuestion } from "@/components/StackedQuestion";

const STARTERS = [
  "מה מצב הצמחים עכשיו?",
  "מה החלטת בשעה האחרונה ולמה?",
  "ראיתי שהעלים קצת חיוורים — מה לעשות?",
  "האם כדאי להחליף מים השבוע?",
];

type HistoryMessage = {
  id: string;
  ts: string;
  role: "user" | "assistant" | "system";
  parts: Array<Record<string, unknown>>;
  source: "chat" | "cron-cycle" | "cron-poll" | "system";
  decision_id: number | null;
  status: string | null;
};

export default function ChatPage() {
  const [activeSystem, setActiveSystemState] = useState<string>("default");
  const [historyLoaded, setHistoryLoaded] = useState(false);
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

  // Load history once we know which system is active.
  useEffect(() => {
    const sys = getActiveSystem();
    setActiveSystemState(sys);
    let cancelled = false;
    (async () => {
      try {
        const qs = sys && sys !== "default" ? `?system=${encodeURIComponent(sys)}` : "";
        const r = await fetch(`/api/chat/history${qs}`, { cache: "no-store" });
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

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, status]);

  function handleSubmit(text?: string) {
    const value = (text ?? input).trim();
    if (!value || status !== "ready") return;
    sendMessage({ text: value });
    setInput("");
  }

  const isEmpty = historyLoaded && messages.length === 0;
  const isStreaming = status === "submitted" || status === "streaming";

  return (
    <main className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-4 py-6 min-h-0">
      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto pb-4 space-y-5 scroll-smooth"
      >
        {isEmpty && (
          <div className="text-center pt-16 pb-8">
            <h1 className="text-2xl font-semibold mb-2">
              שלום ישראל 👋
            </h1>
            <p className="text-zinc-500 text-sm leading-relaxed max-w-md mx-auto">
              אני המחקלאי שמטפל לך בהידרופוניקה.
              דבר איתי על הצמחים, שאל למה ביצעתי משהו, או בקש המלצה.
            </p>
            <div className="mt-6 grid sm:grid-cols-2 gap-2 max-w-lg mx-auto">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSubmit(s)}
                  className="text-right text-sm p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {!historyLoaded && (
          <div className="text-center text-zinc-400 text-sm pt-12">טוען היסטוריה...</div>
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
          <div className="flex items-center gap-2 text-zinc-400 text-sm">
            <Spinner /> חושב...
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm p-3 rounded-lg flex items-start justify-between gap-3">
            <div className="break-words">
              <strong>שגיאה:</strong> {error.message}
            </div>
            <button
              onClick={() => regenerate()}
              className="text-xs px-2 py-1 rounded bg-red-100 dark:bg-red-900/60 hover:bg-red-200 dark:hover:bg-red-900"
            >
              נסה שוב
            </button>
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="border-t border-zinc-200 dark:border-zinc-800 pt-3 flex gap-2"
      >
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
          placeholder="כתוב הודעה..."
          disabled={isStreaming}
          className="flex-1 resize-none bg-zinc-100 dark:bg-zinc-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-50"
          style={{ minHeight: 40, maxHeight: 160 }}
        />
        <button
          type="submit"
          disabled={!input.trim() || isStreaming}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed"
        >
          שלח
        </button>
      </form>
    </main>
  );
}

type UIMessageType = ReturnType<typeof useChat>["messages"][number];

const STATUS_LABEL: Record<string, string> = {
  healthy: "תקין",
  attention: "לב",
  warning: "אזהרה",
  critical: "קריטי",
};
const STATUS_BG: Record<string, string> = {
  healthy: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  attention: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  warning: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
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
  const isUser = message.role === "user";
  const isCronPushed = meta?.source === "cron-cycle" || meta?.source === "cron-poll";

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
      <details className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden max-w-full" open={isLastAssistant}>
        <summary className="cursor-pointer px-4 py-3 list-none flex items-start gap-3">
          <span className="text-lg leading-none mt-0.5">🤖</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1 flex-wrap">
              <span className="font-medium">בדיקה אוטומטית</span>
              {STATUS_LABEL[status] && (
                <span className={`px-1.5 py-0.5 rounded text-xs ${STATUS_BG[status]}`}>
                  {STATUS_LABEL[status]}
                </span>
              )}
              {time && (
                <span className="text-zinc-400" dir="ltr">
                  {time.toLocaleString("he-IL", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                </span>
              )}
            </div>
            {textPart?.text && (
              <p className="text-sm leading-relaxed line-clamp-3">{textPart.text}</p>
            )}
          </div>
          <span className="text-zinc-300 text-sm">▾</span>
        </summary>
        <div className="px-4 pb-4 border-t border-zinc-100 dark:border-zinc-800 pt-3 space-y-3 text-sm">
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
            <div className="text-xs text-zinc-400" dir="ltr">
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
        className={`max-w-[88%] ${
          isUser
            ? "bg-emerald-600 text-white rounded-2xl rounded-bl-md px-4 py-2"
            : "text-zinc-900 dark:text-zinc-100 leading-relaxed"
        }`}
      >
        {message.parts.map((part, i) => {
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
                className="text-xs text-zinc-500 mt-2 mb-1"
              >
                <summary className="cursor-pointer">תהליך מחשבה</summary>
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
                  className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 my-2 max-w-md"
                >
                  <p className="font-medium text-sm leading-relaxed">{input.question}</p>
                  <p className="text-xs text-zinc-400 mt-2">ענה למטה בתיבת ההודעות ↓</p>
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
  const toolName = part.type.replace(/^tool-/, "");
  const state = (part as { state?: string }).state;
  const inputData = (part as { input?: unknown }).input;
  const output = (part as { output?: unknown }).output;

  const labels: Record<string, string> = {
    getCurrentState: "📡 בודק מצב נוכחי",
    getRecentReadings: "📈 שולף היסטוריית חיישן",
    getRecentDecisions: "📋 בודק החלטות אחרונות",
    getPendingTasks: "✅ בודק משימות פתוחות",
    proposeAction: "💧 מציע פעולה",
    requestObservation: "📷 מבקש תצפית",
  };
  const label = labels[toolName] || `⚙️ ${toolName}`;

  return (
    <details className="my-2 text-xs bg-zinc-100 dark:bg-zinc-900 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer px-3 py-2 flex items-center gap-2 select-none">
        <span>{label}</span>
        {state === "input-streaming" || state === "input-available" ? (
          <Spinner />
        ) : null}
        {state === "output-error" && (
          <span className="text-red-500">שגיאה</span>
        )}
      </summary>
      <div className="px-3 pb-2 space-y-2 text-[11px]" dir="ltr">
        {inputData ? (
          <pre className="bg-white dark:bg-zinc-950 rounded p-2 overflow-x-auto">
            {JSON.stringify(inputData, null, 2)}
          </pre>
        ) : null}
        {output !== undefined ? (
          <pre className="bg-white dark:bg-zinc-950 rounded p-2 overflow-x-auto max-h-64">
            {JSON.stringify(output, null, 2)}
          </pre>
        ) : null}
      </div>
    </details>
  );
}

function Spinner() {
  return (
    <span className="inline-block w-3 h-3 border-2 border-zinc-300 dark:border-zinc-700 border-t-emerald-500 rounded-full animate-spin" />
  );
}
