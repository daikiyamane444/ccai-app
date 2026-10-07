"use client";
import { useEffect } from "react";

/** 戻る／進むで履歴キャッシュから復元されたとき、個人の情報を出さないよう再読み込みする（AC-7） */
export function ReloadOnBack() {
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  return null;
}
