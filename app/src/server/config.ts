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

/** 登録を許すメールアドレスの一覧（SPEC-000c）。カンマ・セミコロン・空白・改行で区切る。比較用に小文字へそろえる。空・未設定なら登録は全部拒否（fail closed） */
export function parseAllowedEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

export function allowedSignupEmails(): string[] {
  return parseAllowedEmails(getEnv("SIGNUP_ALLOWED_EMAILS"));
}

export type DbConnection = { connectionString: string; ssl?: { rejectUnauthorized: boolean } };

/**
 * DB の接続情報。次のどちらか。
 * 1. DATABASE_URL（組み立て済みの接続文字列。自動テストはこちら）
 * 2. 部品ごとの環境変数 DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD（人間が貼り付けるだけで済むようにする。SPEC-000c 付録A-2 手順5）
 *    - DB_USER の既定は ccai_app（最小権限のアプリ用ロール）。ホストが Supabase のプーラー（*.pooler.supabase.com）のときは、
 *      ユーザー名の後ろに ".<プロジェクトID>"（SUPABASE_URL から取り出す）を自動で付ける
 *    - DB_PORT の既定は、プーラーなら 6543（トランザクションモード。サーバーレス向け）、それ以外は 5432
 * SSL: ローカル以外のホストでは既定で暗号化する（DB_SSL=disable で無効、=require で強制）。証明書の検証はしない（暗号化のみ。architecture.md 12-4 に記録）
 */
export function buildDatabaseConnection(read: (name: string) => string | undefined = getEnv): DbConnection {
  const sslMode = read("DB_SSL")?.toLowerCase();
  const url = read("DATABASE_URL");
  if (url) {
    return sslMode === "require" ? { connectionString: url, ssl: { rejectUnauthorized: false } } : { connectionString: url };
  }
  const host = read("DB_HOST");
  const password = read("DB_PASSWORD");
  if (!host || !password) {
    throw new ConfigError("DB の接続先が設定されていません（DATABASE_URL、または DB_HOST と DB_PASSWORD。app/README.md を参照）");
  }
  const isPooler = host.endsWith(".pooler.supabase.com");
  let user = read("DB_USER") ?? "ccai_app";
  if (isPooler && !user.includes(".")) {
    const supabaseUrl = read("SUPABASE_URL");
    let ref: string | undefined;
    try {
      ref = supabaseUrl ? new URL(supabaseUrl).hostname.split(".")[0] : undefined;
    } catch {
      ref = undefined;
    }
    if (!ref) throw new ConfigError("プーラーに接続するには SUPABASE_URL が必要です（プロジェクトIDを取り出すため）");
    user = `${user}.${ref}`;
  }
  const port = read("DB_PORT") ?? (isPooler ? "6543" : "5432");
  if (!/^\d{1,5}$/.test(port)) throw new ConfigError("DB_PORT は数字で指定してください");
  const name = read("DB_NAME") ?? "postgres";
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const useSsl = sslMode === "require" || (sslMode !== "disable" && !local);
  const connectionString = `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(name)}`;
  return useSsl ? { connectionString, ssl: { rejectUnauthorized: false } } : { connectionString };
}
