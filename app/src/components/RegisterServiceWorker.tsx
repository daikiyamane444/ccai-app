"use client";
import { useEffect } from "react";

/** Service Worker は「何もキャッシュしない」ものを登録する（public/sw.js。SPEC-000a AC-17） */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);
  return null;
}
