import { allowedSignupEmails } from "../config";

/**
 * 新規登録の許可（SPEC-000c）。一覧にあるメールアドレスだけ登録できる。一覧が空なら全部拒否（fail closed）。
 * 比較は前後の空白を除き、大文字・小文字を区別しない。拒否の理由（一覧の有無・中身）は呼び出し側が利用者に伝えない。
 * 今後 登録の方式を変える（招待制など）ときは、この部品の差し替えで済むようにしている。
 */
export type SignupPolicy = { isAllowed(email: string): boolean };

export function createSignupPolicy(list: readonly string[]): SignupPolicy {
  const set = new Set(list.map((e) => e.trim().toLowerCase()).filter(Boolean));
  return { isAllowed: (email) => set.size > 0 && set.has(email.trim().toLowerCase()) };
}

/** 環境変数 SIGNUP_ALLOWED_EMAILS から作る（呼ぶたびに読む。サーバー側だけ） */
export function envSignupPolicy(): SignupPolicy {
  return createSignupPolicy(allowedSignupEmails());
}
