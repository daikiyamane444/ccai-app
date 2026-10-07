import type { AuthProvider, AuthUser, Tokens } from "./auth";
import { isProduction, sessionCookieMaxAgeSeconds } from "./config";

export const SESSION_COOKIE = "ccai_session";

/** cookie の値：{a: アクセストークン, r: リフレッシュトークン} を base64url にしたもの。ブラウザのスクリプトからは読めない（HttpOnly） */
export function encodeSession(t: Tokens): string {
  return Buffer.from(JSON.stringify({ a: t.accessToken, r: t.refreshToken }), "utf8").toString("base64url");
}

export function decodeSession(value: string | undefined): Tokens | null {
  if (!value) return null;
  try {
    const o = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof o?.a === "string" && typeof o?.r === "string" && o.a && o.r) return { accessToken: o.a, refreshToken: o.r };
  } catch {
    /* 壊れた cookie は無いものとして扱う */
  }
  return null;
}

export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** HttpOnly・SameSite=Lax を常に付け、本番（NODE_ENV=production）では Secure も付ける（AC-8） */
export function sessionCookieHeader(tokens: Tokens): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeSession(tokens)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${sessionCookieMaxAgeSeconds()}`,
  ];
  if (isProduction()) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookieHeader(): string {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (isProduction()) parts.push("Secure");
  return parts.join("; ");
}

export type SessionState =
  | { state: "none" } // cookie なし・壊れている・失効
  | { state: "ok"; user: AuthUser; tokens: Tokens; renewedCookie?: string };

/**
 * cookie から利用者を決める。アクセストークンが無効なら、リフレッシュトークンで1回だけ更新を試みる。
 * 認証基盤が不調のときは AuthError("unavailable") を投げる（利用者を未ログイン扱いにしない）。
 */
export async function resolveSession(auth: AuthProvider, cookieValue: string | undefined, allowRefresh = true): Promise<SessionState> {
  const tokens = decodeSession(cookieValue);
  if (!tokens) return { state: "none" };
  const user = await auth.verify(tokens.accessToken);
  if (user) return { state: "ok", user, tokens };
  if (!allowRefresh) return { state: "none" };
  const renewed = await auth.refresh(tokens.refreshToken);
  if (!renewed) return { state: "none" };
  return { state: "ok", user: renewed.user, tokens: renewed.tokens, renewedCookie: sessionCookieHeader(renewed.tokens) };
}
