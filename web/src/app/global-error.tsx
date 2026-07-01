"use client";

/**
 * Root-layout error boundary — catches throws in the layout itself. Replaces
 * the ENTIRE root layout when active, so it must render its own <html>/<body>
 * and can't rely on globals.css (brand colors hardcoded: void/parchment/basil).
 * Note: this Next version passes `unstable_retry` (not `reset`).
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="he" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0c0c0a",
          color: "#eeede8",
          fontFamily: "system-ui, sans-serif",
          padding: 32,
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <div style={{ fontSize: "2rem", marginBottom: 12 }}>🌱</div>
          <h1 style={{ fontWeight: 500, fontSize: "1.3rem", marginBottom: 8 }}>משהו השתבש לרגע</h1>
          <p style={{ fontSize: ".95rem", color: "#9a9a92", lineHeight: 1.6, marginBottom: 20 }}>
            הגידול שלך ממשיך כרגיל — זו תקלה בתצוגה בלבד. נסה לרענן.
          </p>
          <button
            onClick={() => unstable_retry()}
            style={{
              background: "#89a83e",
              color: "#0c0c0a",
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
            <p dir="ltr" style={{ fontSize: ".7rem", color: "#606058", marginTop: 16 }}>
              ref: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
