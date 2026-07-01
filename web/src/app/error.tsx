"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary — without it, any render throw is a silent white
 * screen on the grower's phone (a PWA has no browser chrome to recover with).
 * Warm Hebrew fallback in the brand voice + a retry that re-renders the
 * segment. Note: this Next version passes `unstable_retry` (not `reset`).
 */
export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[error-boundary]", error);
  }, [error]);

  return (
    <main
      dir="rtl"
      style={{
        flex: 1,
        display: "grid",
        placeItems: "center",
        padding: 32,
        minHeight: "60vh",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <div style={{ fontSize: "2rem", marginBottom: 12 }}>🌱</div>
        <h1
          style={{
            fontFamily: "var(--f-display)",
            fontWeight: 500,
            fontSize: "1.3rem",
            color: "var(--c-parchment)",
            marginBottom: 8,
          }}
        >
          משהו השתבש לרגע
        </h1>
        <p style={{ fontSize: ".95rem", color: "var(--c-ash)", lineHeight: 1.6, marginBottom: 20 }}>
          הגידול שלך ממשיך כרגיל — זו תקלה בתצוגה בלבד. נסה לרענן.
        </p>
        <button
          onClick={() => unstable_retry()}
          style={{
            background: "var(--c-basil)",
            color: "var(--c-void)",
            border: "none",
            borderRadius: 10,
            padding: "10px 28px",
            fontSize: "1rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          רענן
        </button>
        {error.digest && (
          <p dir="ltr" style={{ fontSize: ".7rem", color: "var(--c-stone)", marginTop: 16 }}>
            ref: {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
