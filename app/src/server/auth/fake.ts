import { randomUUID, randomBytes } from "node:crypto";
import { AuthError, type AuthProvider, type AuthResult, type AuthUser } from "./types";

/**
 * 自動テスト用の偽の認証基盤（Supabase Auth の振る舞いを模す）。本番コードからは使わない。
 * 模している点: メールの大文字小文字を区別しない／同じメールの二重登録は email_taken／誤りは invalid_credentials で区別しない／
 *   ログアウト（signOut）でそのセッションが失効する／アカウント削除で全セッションが失効する／アクセストークンには期限がある。
 * 模していない点・本物との差は docs/architecture.md の「SPEC-000c に回す確認項目」に記録する。
 */
export type FakeAuthOptions = {
  /** アカウント作成・削除を、テスト用DBの auth.users に反映する（本物は auth.users に行ができるため） */
  mirror?: { insert(user: AuthUser): Promise<void>; remove(userId: string): Promise<void> };
  /** 各操作に入れる遅延（連打・同時実行のテスト用） */
  delayMs?: number;
  /** 認証基盤の最小パスワード長（Supabase の既定は6） */
  minPasswordLength?: number;
};

type Account = { user: AuthUser; password: string };
type Session = { userId: string; refreshToken: string; revoked: boolean };

export class FakeAuth implements AuthProvider {
  private accounts = new Map<string, Account>(); // key: 小文字のメール
  private byId = new Map<string, Account>();
  private access = new Map<string, { sessionId: string; expired: boolean }>();
  private sessions = new Map<string, Session>();
  private refreshIndex = new Map<string, string>(); // refreshToken -> sessionId
  public unavailable = false;

  constructor(private opts: FakeAuthOptions = {}) {}

  private async tick() {
    if (this.unavailable) throw new AuthError("unavailable");
    if (this.opts.delayMs) await new Promise((r) => setTimeout(r, this.opts.delayMs));
    if (this.unavailable) throw new AuthError("unavailable");
  }

  private newSession(userId: string): AuthResult["tokens"] {
    const sessionId = randomUUID();
    const accessToken = `fa_${randomBytes(12).toString("hex")}`;
    const refreshToken = `fr_${randomBytes(12).toString("hex")}`;
    this.sessions.set(sessionId, { userId, refreshToken, revoked: false });
    this.access.set(accessToken, { sessionId, expired: false });
    this.refreshIndex.set(refreshToken, sessionId);
    return { accessToken, refreshToken };
  }

  async signUp(email: string, password: string): Promise<AuthResult> {
    await this.tick();
    const key = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(key)) throw new AuthError("invalid_email");
    if (password.length < (this.opts.minPasswordLength ?? 6)) throw new AuthError("weak_password");
    if (this.accounts.has(key)) throw new AuthError("email_taken"); // 確認と登録の間に await を挟まない（原子的）
    const account: Account = { user: { id: randomUUID(), email: key }, password };
    this.accounts.set(key, account);
    this.byId.set(account.user.id, account);
    if (this.opts.mirror) await this.opts.mirror.insert(account.user);
    return { user: account.user, tokens: this.newSession(account.user.id) };
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    await this.tick();
    const account = this.accounts.get(email.trim().toLowerCase());
    if (!account || account.password !== password) throw new AuthError("invalid_credentials");
    return { user: account.user, tokens: this.newSession(account.user.id) };
  }

  async verify(accessToken: string): Promise<AuthUser | null> {
    await this.tick();
    const a = this.access.get(accessToken);
    if (!a || a.expired) return null;
    const s = this.sessions.get(a.sessionId);
    if (!s || s.revoked) return null;
    return this.byId.get(s.userId)?.user ?? null;
  }

  async refresh(refreshToken: string): Promise<AuthResult | null> {
    await this.tick();
    const sessionId = this.refreshIndex.get(refreshToken);
    const s = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!s || s.revoked) return null;
    const user = this.byId.get(s.userId)?.user;
    if (!user) return null;
    s.revoked = true; // リフレッシュトークンは使い捨て（本物と同じ）
    return { user, tokens: this.newSession(user.id) };
  }

  async signOut(accessToken: string): Promise<void> {
    await this.tick();
    const a = this.access.get(accessToken);
    const s = a ? this.sessions.get(a.sessionId) : undefined;
    if (s) s.revoked = true;
  }

  async deleteUser(userId: string): Promise<void> {
    await this.tick();
    const account = this.byId.get(userId);
    if (!account) return;
    this.byId.delete(userId);
    this.accounts.delete(account.user.email);
    for (const s of this.sessions.values()) if (s.userId === userId) s.revoked = true;
    if (this.opts.mirror) await this.opts.mirror.remove(userId);
  }

  // --- テスト用の操作 ---
  expireAccessToken(accessToken: string) {
    const a = this.access.get(accessToken);
    if (a) a.expired = true;
  }
  accountCount(): number {
    return this.accounts.size;
  }
  hasAccount(email: string): boolean {
    return this.accounts.has(email.trim().toLowerCase());
  }
}
