"use client";
import { useState } from "react";

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  async function onClick() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } catch {
      /* 通信失敗でもログイン画面へ（cookie が残っていればサーバー側で次の操作時に判定される） */
    }
    window.location.replace("/login");
  }
  return (
    <button type="button" className="btn" onClick={onClick} disabled={busy}>
      ログアウト
    </button>
  );
}
