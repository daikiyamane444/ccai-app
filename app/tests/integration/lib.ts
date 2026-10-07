// 結合テスト（本物の Supabase／公開URL）で使う部品のうち、自動テスト（npm test）でも確かめられる純粋な部分。
// 重要: 失敗時のメッセージに秘密の値・本人のメールアドレス・トークンを出さない。比較は「真偽」だけを expect に渡し、値そのものは渡さない。

/** テスト用ユーザーのメールアドレス。配信されないドメイン（.invalid）に、実行IDと連番を入れた決まった形 */
export const CI_EMAIL_RE = /^ccai-ci\+[a-z0-9]+-[0-9a-z]+@example\.invalid$/;

export function ciEmail(runId: string, n: number | string): string {
  const id = runId.toLowerCase().replace(/[^a-z0-9]/g, "") || "local";
  return `ccai-ci+${id}-${n}@example.invalid`;
}

export function isCiEmail(email: string | undefined | null): boolean {
  return !!email && CI_EMAIL_RE.test(email);
}

/** 実行ID（GitHub Actions なら実行番号。ローカルは時刻から） */
export function runIdFromEnv(env: Record<string, string | undefined> = process.env): string {
  const id = (env.CI_RUN_ID ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return id || `l${Date.now().toString(36)}`;
}

/**
 * 配信物（文章）の中に、秘密の値や環境変数名が含まれていないかを調べる。返すのは「何に当たったか」のラベルだけ（値は返さない・出さない）。
 * secrets は { ラベル: 値 }。空の値は無視する（値が未設定の検査は省く）。
 */
export function leakLabels(texts: readonly string[], secrets: Record<string, string | undefined>): string[] {
  const hits = new Set<string>();
  for (const [label, value] of Object.entries(secrets)) {
    if (!value || value.length < 4) continue;
    if (texts.some((t) => t.includes(value))) hits.add(label);
  }
  return [...hits].sort();
}

/** 配信物に出てはいけない環境変数名 */
export const FORBIDDEN_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_URL",
  "DATABASE_URL",
  "DB_PASSWORD",
  "DB_HOST",
  "SIGNUP_ALLOWED_EMAILS",
  "service_role",
];

/** x-vercel-id（例: "hnd1::hnd1::abc-123"）から、関数の実行地域（2番目）を取り出す。形が違えば undefined */
export function functionRegionFromVercelId(id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  const parts = id.split("::");
  return parts.length >= 3 ? parts[1] : undefined;
}

export type Queryable = { query(sql: string): Promise<{ rows: Record<string, unknown>[] }> };

/**
 * anon / authenticated に、マイグレーションが許可した以外のテーブル権限がないかを調べる（AC-10）。
 * 許可（SPEC-000a のマイグレーション）: authenticated は profiles の SELECT・INSERT と UPDATE(display_name)、pair_members・pairs の SELECT。anon は何もなし。
 * 返り値は違反の一覧（空なら問題なし）。public の全テーブル・ビュー × 7種の権限を調べ、列単位の UPDATE・INSERT・REFERENCES も見る。
 */
export async function tablePrivilegeViolations(db: Queryable): Promise<string[]> {
  const allowedTable: Record<string, string[]> = {
    "authenticated:profiles": ["SELECT", "INSERT"],
    "authenticated:pair_members": ["SELECT"],
    "authenticated:pairs": ["SELECT"],
  };
  const r = await db.query(`
    select c.relname::text as rel, r.rolname::text as role, p.priv::text as priv,
           has_table_privilege(r.rolname, c.oid, p.priv) as tbl,
           (p.priv in ('SELECT','INSERT','UPDATE','REFERENCES') and exists (
              select 1 from pg_attribute a
               where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                 and has_column_privilege(r.rolname, c.oid, a.attname, p.priv)
                 and not has_table_privilege(r.rolname, c.oid, p.priv))) as col_only
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      cross join (values ('anon'), ('authenticated')) as r(rolname)
      cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) as p(priv)
     where c.relkind in ('r','p','v','m','f')`);
  const out: string[] = [];
  for (const row of r.rows) {
    const key = `${row.role}:${row.rel}`;
    const allowed = allowedTable[key] ?? [];
    if (row.tbl && !allowed.includes(String(row.priv))) out.push(`${key} ${row.priv}`);
    if (row.col_only) {
      // 列単位の許可は、profiles.display_name の UPDATE だけ
      const only = key === "authenticated:profiles" && row.priv === "UPDATE";
      if (only) {
        const cols = await db.query(`
          select a.attname::text as col from pg_attribute a
           where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped
             and has_column_privilege('authenticated', 'public.profiles'::regclass, a.attname, 'UPDATE')`);
        const names = cols.rows.map((x) => String(x.col));
        if (names.length !== 1 || names[0] !== "display_name") out.push(`${key} UPDATE(列: ${names.join(",")})`);
      } else {
        out.push(`${key} ${row.priv}(列単位)`);
      }
    }
  }
  return [...new Set(out)].sort();
}
