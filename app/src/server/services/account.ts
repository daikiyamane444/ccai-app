import type { AuthProvider, AuthResult, Tokens } from "../auth";
import { AuthError } from "../auth";
import type { Db } from "../db/pool";
import { createProfile } from "../db/profile";
import { deleteUserData } from "../privileged";
import { MSG } from "./messages";
import { validateRegister, type FieldErrors } from "./validation";

export type Deps = { auth: AuthProvider; db: Db };

export type RegisterOutcome =
  | { ok: true; tokens: Tokens }
  | { ok: false; status: number; message: string; fieldErrors?: FieldErrors };

function authFailure(e: unknown): { status: number; message: string } {
  if (e instanceof AuthError) {
    if (e.code === "unavailable") return { status: 503, message: MSG.network };
    if (e.code === "not_configured") return { status: 503, message: MSG.notConfigured };
  }
  return { status: 500, message: MSG.unexpected };
}

export async function registerUser(deps: Deps, input: Record<string, unknown>): Promise<RegisterOutcome> {
  const v = validateRegister({
    email: input.email,
    password: input.password,
    displayName: input.displayName,
    ageConfirmed: input.ageConfirmed,
  });
  if (!v.ok) return { ok: false, status: 400, message: MSG.badRequest, fieldErrors: v.errors };

  let result: AuthResult;
  try {
    result = await deps.auth.signUp(v.value.email, v.value.password);
  } catch (e) {
    if (e instanceof AuthError) {
      // Q-P9（仮決定）: 公開前まで「登録済み」と分かる応答を許容する。既存アカウントへのログインや情報の表示はしない
      if (e.code === "email_taken") return { ok: false, status: 409, message: MSG.emailTaken, fieldErrors: { email: MSG.emailTaken } };
      if (e.code === "weak_password") return { ok: false, status: 400, message: MSG.badRequest, fieldErrors: { password: MSG.passwordShort } };
      if (e.code === "invalid_email") return { ok: false, status: 400, message: MSG.badRequest, fieldErrors: { email: MSG.emailFormat } };
    }
    return { ok: false, ...authFailure(e) };
  }

  try {
    await createProfile(deps.db, result.user.id, v.value.displayName);
  } catch {
    // プロフィールが作れなければ、できかけのアカウントを残さない（認証基盤側も削除する）
    await deps.auth.deleteUser(result.user.id).catch(() => undefined);
    return { ok: false, status: 500, message: MSG.unexpected };
  }
  return { ok: true, tokens: result.tokens };
}

export type LoginOutcome = { ok: true; tokens: Tokens } | { ok: false; status: number; message: string };

export async function loginUser(deps: Deps, input: Record<string, unknown>): Promise<LoginOutcome> {
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  // 入力不備も、誤りと同じ文言にする（アカウントの有無・形式の判定を漏らさない）
  if (!email || !password) return { ok: false, status: 400, message: MSG.loginFailed };
  try {
    const r = await deps.auth.signIn(email, password);
    return { ok: true, tokens: r.tokens };
  } catch (e) {
    if (e instanceof AuthError && (e.code === "invalid_credentials" || e.code === "invalid_email")) {
      return { ok: false, status: 401, message: MSG.loginFailed };
    }
    return { ok: false, ...authFailure(e) };
  }
}

/**
 * ユーザー単位の全データ削除（画面なし。SPEC-000a AC-12）。
 * DB のデータ（プロフィール・pair の所属）→ 認証基盤のアカウント、の順に消す。途中で失敗したら例外（再実行で続きを消せる）。
 */
export async function deleteAccount(deps: Deps, userId: string): Promise<void> {
  await deleteUserData(deps.db, userId);
  await deps.auth.deleteUser(userId);
}
