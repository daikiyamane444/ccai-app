"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";

const NETWORK_MSG = "通信できませんでした。電波の良い場所でもう一度お試しください";
type Errors = Partial<Record<"email" | "password" | "displayName" | "ageConfirmed", string>>;

export function RegisterForm() {
  const [errors, setErrors] = useState<Errors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return; // 連打しても1回しか送らない（サーバー側でも二重に作られない）
    setBusy(true);
    setErrors({});
    setGeneral(null);
    const f = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: f.get("email"),
          password: f.get("password"),
          displayName: f.get("displayName"),
          ageConfirmed: f.get("ageConfirmed") === "on",
        }),
      });
      if (res.ok) {
        window.location.assign("/");
        return;
      }
      const data = await res.json().catch(() => null);
      if (data?.fieldErrors && Object.keys(data.fieldErrors).length) setErrors(data.fieldErrors);
      else setGeneral(data?.error ?? NETWORK_MSG);
    } catch {
      setGeneral(NETWORK_MSG);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <h1>新規登録</h1>
      <label className="field">
        <span>メールアドレス</span>
        <input name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" required />
        {errors.email && <em className="error">{errors.email}</em>}
      </label>
      <label className="field">
        <span>パスワード（8文字以上）</span>
        <input name="password" type="password" autoComplete="new-password" required />
        {errors.password && <em className="error">{errors.password}</em>}
      </label>
      <label className="field">
        <span>表示名（任意・20文字以内）</span>
        <input name="displayName" type="text" autoComplete="nickname" maxLength={40} />
        {errors.displayName && <em className="error">{errors.displayName}</em>}
      </label>
      <label className="check">
        <input name="ageConfirmed" type="checkbox" />
        <span>18歳以上です</span>
      </label>
      {errors.ageConfirmed && <em className="error">{errors.ageConfirmed}</em>}
      {general && (
        <p role="alert" className="error">
          {general}
        </p>
      )}
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? "登録中…" : "登録"}
      </button>
      <Link href="/login" className="btn link">
        ログインはこちら
      </Link>
    </form>
  );
}
