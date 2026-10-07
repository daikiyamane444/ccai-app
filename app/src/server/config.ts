// 環境変数の読み取りはすべてここ（と privileged/）を通す。名前は .env.example に説明つきで並べる（AC-3 のテストが突き合わせる）。

export function getEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** セッションcookieの有効日数（cookie側の上限。認証基盤の有効期間とは別。Q-P8 の 30日目安に合わせた既定） */
export function sessionCookieMaxAgeSeconds(): number {
  const raw = getEnv("SESSION_COOKIE_MAX_AGE_DAYS");
  const days = raw ? Number(raw) : 30;
  const valid = Number.isFinite(days) && days > 0 && days <= 400 ? days : 30;
  return Math.round(valid * 24 * 60 * 60);
}

export function supabaseAuthConfig(): { url: string; anonKey: string } | undefined {
  const url = getEnv("SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_ANON_KEY");
  if (url && anonKey) return { url, anonKey };
  return undefined;
}

export function databaseUrl(): string {
  const url = getEnv("DATABASE_URL");
  if (!url) throw new ConfigError("DATABASE_URL が設定されていません（app/README.md を参照）");
  return url;
}
