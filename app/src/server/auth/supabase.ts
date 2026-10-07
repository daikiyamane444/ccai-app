import { createClient, type AuthError as SbAuthError, type Session, type User } from "@supabase/supabase-js";
import { AuthError, type AuthProvider, type AuthResult, type AuthUser } from "./types";
import { supabaseAuthConfig } from "../config";
import { deleteAuthUser, revokeAuthSession } from "../privileged";

/**
 * Supabase Auth のアダプタ。サーバー側だけで使う（ブラウザには SDK を一切送らない。AC-8）。
 * 注意: 本物の Supabase Auth との結合は自動テスト（npm test）の対象外。SPEC-000c の結合テスト（GitHub Actions。app/tests/integration/）で確かめる。
 */
function client() {
  const cfg = supabaseAuthConfig();
  if (!cfg) throw new AuthError("not_configured");
  return createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function toUser(u: User): AuthUser {
  return { id: u.id, email: u.email ?? "" };
}

function toResult(user: User, session: Session): AuthResult {
  return { user: toUser(user), tokens: { accessToken: session.access_token, refreshToken: session.refresh_token } };
}

function mapError(e: SbAuthError): AuthError {
  const code = e.code ?? "";
  if (code === "user_already_exists" || code === "email_exists") return new AuthError("email_taken");
  if (code === "weak_password") return new AuthError("weak_password");
  if (code === "email_address_invalid" || code === "validation_failed") return new AuthError("invalid_email");
  if (code === "invalid_credentials" || code === "email_not_confirmed" || code === "user_not_found") {
    return new AuthError("invalid_credentials");
  }
  if (e.name === "AuthRetryableFetchError" || (e.status ?? 0) >= 500 || e.status === 0) return new AuthError("unavailable");
  return new AuthError("unexpected", code || e.name);
}

export const supabaseAuth: AuthProvider = {
  async signUp(email, password) {
    const { data, error } = await client().auth.signUp({ email, password });
    if (error) throw mapError(error);
    // メール確認を有効にした設定では session が返らない。000a はメール確認なしの前提（Q-P9）
    if (!data.user || !data.session) throw new AuthError("unexpected", "no session on sign up (email confirmation enabled?)");
    return toResult(data.user, data.session);
  },
  async signIn(email, password) {
    const { data, error } = await client().auth.signInWithPassword({ email, password });
    if (error) throw mapError(error);
    return toResult(data.user, data.session);
  },
  async verify(accessToken) {
    const { data, error } = await client().auth.getUser(accessToken);
    if (error || !data.user) {
      if (error && (error.name === "AuthRetryableFetchError" || (error.status ?? 0) >= 500)) throw new AuthError("unavailable");
      return null;
    }
    return toUser(data.user);
  },
  async refresh(refreshToken) {
    const { data, error } = await client().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.user || !data.session) return null;
    return toResult(data.user, data.session);
  },
  async signOut(accessToken) {
    const r = await revokeAuthSession(accessToken);
    if (r.ok) return;
    // 通信失敗・基盤の不調と、トークンの問題（期限切れ・失効済み・不正）を分ける。後者は呼び出し側が更新してからやり直す
    if (r.status === 0 || r.status >= 500) throw new AuthError("unavailable");
    throw new AuthError("invalid_token", r.code);
  },
  async deleteUser(userId) {
    await deleteAuthUser(userId);
  },
};
