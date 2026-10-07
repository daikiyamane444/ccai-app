"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";

const NETWORK_MSG = "通信できませんでした。電波の良い場所でもう一度お試しください";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: f.get("email"), password: f.get("password") }),
      });
      if (res.ok) {
        window.location.assign("/");
        return;
      }
      const data = await res.json().catch(() => null);
      setError(data?.error ?? NETWORK_MSG);
    } catch {
      setError(NETWORK_MSG);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <h1>ログイン</h1>
      <p className="muted">CCAI（仮称）</p>
      <label className="field">
        <span>メールアドレス</span>
        <input name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" required />
      </label>
      <label className="field">
        <span>パスワード</span>
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? "ログイン中…" : "ログイン"}
      </button>
      <Link href="/register" className="btn link">
        新規登録はこちら
      </Link>
    </form>
  );
}
