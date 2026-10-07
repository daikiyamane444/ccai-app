export type AuthUser = { id: string; email: string };
export type Tokens = { accessToken: string; refreshToken: string };
export type AuthResult = { user: AuthUser; tokens: Tokens };

export type AuthErrorCode =
  | "invalid_credentials" // ログイン失敗（アカウントの有無を区別しない）
  | "email_taken" // 登録済みのメールアドレス（Q-P9 仮決定：公開前まで区別して返すことを許容）
  | "weak_password"
  | "invalid_email"
  | "unavailable" // 通信失敗・基盤の一時的な不調
  | "invalid_token" // トークンが無効・期限切れ・失効済み
  | "not_configured" // 接続先が未設定
  | "unexpected";

export class AuthError extends Error {
  constructor(public code: AuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = "AuthError";
  }
}

/**
 * 認証基盤とのやり取りの共通の形。アプリの他の部分は基盤の製品名を知らない。
 * 実装: supabase.ts（本物）、fake.ts（自動テスト用の偽物）、not-configured.ts（接続先が未設定のとき）。
 */
export interface AuthProvider {
  signUp(email: string, password: string): Promise<AuthResult>;
  signIn(email: string, password: string): Promise<AuthResult>;
  /** アクセストークンが有効なら利用者を返す。無効・失効・期限切れは null */
  verify(accessToken: string): Promise<AuthUser | null>;
  /** リフレッシュトークンから新しいトークンを得る。失敗は null */
  refresh(refreshToken: string): Promise<AuthResult | null>;
  /**
   * 利用者の全セッションを失効させる（全端末からのログアウト。SPEC-000c A-8。端末を相手に見られた場合に、別の端末から全部を切れるほうが安全側）。
   * アクセストークンが無効・期限切れなら AuthError("invalid_token") を投げる（本物の Supabase Auth と同じ）。呼び出し側は更新してから再度呼ぶ。
   */
  signOut(accessToken: string): Promise<void>;
  /** 認証基盤上のアカウントを削除する */
  deleteUser(userId: string): Promise<void>;
}
