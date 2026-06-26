"use client";

/**
 * Admin unlock form — shown by the architecture page (server component) when the
 * caller isn't a verified admin. Posts the secret to /api/admin/unlock, which
 * sets the httpOnly admin cookie; on success we reload into the real surface.
 */
import { useState } from "react";

export default function AdminUnlock({ configured }: { configured: boolean }) {
  const [token, setToken] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (r.ok) {
        window.location.reload();
        return;
      }
      const j = await r.json().catch(() => ({}));
      setErr(j.error || `שגיאה (${r.status})`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex-1 grid place-items-center p-8" dir="rtl">
      <div className="w-full max-w-sm bg-[var(--surface-warm)] rounded-xl p-6 border border-[rgba(238,237,232,0.08)] space-y-4">
        <div className="space-y-1">
          <h1 className="text-lg font-bold">אזור אדמין</h1>
          <p className="text-sm text-[var(--c-ash)] leading-relaxed">
            המשטח הזה מציג את הארכיטקטורה והמצב החי של TELOS — לאדמינים בלבד.
          </p>
        </div>
        {configured ? (
          <form onSubmit={submit} className="space-y-3">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="קוד גישה"
              className="w-full rounded-lg bg-[var(--c-void)] border border-[rgba(238,237,232,0.12)] px-3 py-2 text-sm"
              dir="ltr"
              autoFocus
            />
            {err && <p className="text-xs text-[var(--c-terra)]">{err}</p>}
            <button
              type="submit"
              disabled={busy || !token.trim()}
              className="w-full rounded-lg py-2 text-sm font-medium border-2 border-[var(--c-basil)] disabled:opacity-50 hover:bg-[color-mix(in_srgb,var(--c-basil)_18%,transparent)] transition-colors"
            >
              {busy ? "פותח…" : "כניסה"}
            </button>
          </form>
        ) : (
          <p className="text-xs text-[var(--c-ash)]">
            גישת אדמין לא הוגדרה בשרת (חסר <code dir="ltr">ADMIN_ACCESS_TOKEN</code>).
          </p>
        )}
      </div>
    </main>
  );
}
