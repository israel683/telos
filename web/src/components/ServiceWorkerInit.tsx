"use client";

import { useEffect } from "react";

/** Registers the Web Push service worker once, app-wide. Mounted in the layout. */
export function ServiceWorkerInit() {
  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((e) => console.error("[sw] register failed", e));
    }
  }, []);
  return null;
}
