"use client";

import { useEffect } from "react";

// Registers the Rota PWA's own service worker (rota/public/sw.js). It lives on the
// rota domain, so it is entirely separate from the main app's worker.
export function RegisterRotaWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // An app that works without offline support is better than one that doesn't load.
    });
  }, []);
  return null;
}
