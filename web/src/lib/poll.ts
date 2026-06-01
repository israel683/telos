/**
 * Visibility-aware polling.
 *
 * Every frontend surface polls the API on an interval (tasks, status, bottle
 * levels, readings, decisions…). Each poll is a DB query, and a DB query wakes
 * the Neon compute. A plain setInterval keeps firing even when the tab is in
 * the background or the laptop is asleep with the app left open — which pins
 * Neon awake 24/7 and burns the entire CU-hour budget for no one's benefit.
 *
 * This runs `fn` every `ms` ONLY while the document is visible:
 *   - tab hidden  → stop polling (Neon is free to scale to zero)
 *   - tab visible → fire `fn` once immediately (catch up on what was missed)
 *                   then resume the interval
 *
 * Callers still do their own initial fetch on mount; this only owns the
 * recurring timer. Returns a cleanup function — call it from the effect's
 * teardown. SSR-safe (no-ops without a document).
 */
export function startVisibilityAwarePolling(fn: () => void, ms: number): () => void {
  if (typeof document === "undefined") return () => {};

  let timer: ReturnType<typeof setInterval> | null = null;

  const start = () => {
    if (timer === null) timer = setInterval(fn, ms);
  };
  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  const onVisibility = () => {
    if (document.hidden) {
      stop();
    } else {
      fn(); // catch up immediately on return
      start();
    }
  };

  if (!document.hidden) start();
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
