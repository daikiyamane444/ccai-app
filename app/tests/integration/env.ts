// 結合テストの共通部品（本物の Supabase に接続する）。npm test からは読み込まれない（*.itest.ts は vitest.integration.config.ts だけが拾う）。
// 守り（SPEC-000c 2-B）:
//  - 触るのは、決まった形（ccai-ci+…@example.invalid）のユーザーだけ
//  - 最初と最後に、それ以外のユーザー数と、それらのプロフィール・所属の件数を比べ、変わっていたら失敗
//  - マイグレーションの適用・設定の変更はしない
//  - 失敗時のメッセージに秘密・トークン・本人のメールアドレスを出さない
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll } from "vitest";
import { buildDatabaseConnection } from "@/server/config";
import { createDb, type Db } from "@/server/db/pool";
import { supabaseAuth } from "@/server/auth/supabase";
import { createSignupPolicy } from "@/server/services/signup-policy";
import type { Deps } from "@/server/services/account";
import { ciEmail, isCiEmail, ok, runIdFromEnv, sameNumber } from "./lib";

// テスト用ユーザーのパスワード。実行ごとにランダムに作る（コードに書かない・出力しない）。
// 起動スクリプト（scripts/run-integration.mjs）が CI_TEST_PASSWORD に入れて渡し、出力の伏せ字の対象にする。なければここで作る
export const PASSWORD = process.env.CI_TEST_PASSWORD || `Ci-${randomBytes(18).toString("hex")}`;

export function requireEnv(...names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) out[n] = v.trim();
    else missing.push(n);
  }
  if (missing.length) throw new Error(`結合テストに必要な設定がありません: ${missing.join(", ")}（GitHub の Actions secrets を確認）`);
  return out;
}

export function adminClient(): SupabaseClient {
  const e = requireEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  return createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export type AdminUser = { id: string; email?: string };

export async function listAllUsers(admin: SupabaseClient): Promise<AdminUser[]> {
  const all: AdminUser[] = [];
  for (let page = 1; page < 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.code ?? error.name}`);
    all.push(...data.users.map((u) => ({ id: u.id, email: u.email })));
    if (data.users.length < 200) break;
  }
  return all;
}

export type Snapshot = { nonCiUsers: number; profiles: number; pairMembers: number };

export function realDeps(): Deps {
  return { auth: supabaseAuth, db: createDb(buildDatabaseConnection()), signup: createSignupPolicy([]) };
}

/** service_role に切り替えて読む（テーブル権限のないアプリ用ロールで接続したまま。SET ROLE の確認も兼ねる） */
export async function asService<T>(db: Db, fn: (c: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE service_role");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export async function snapshot(admin: SupabaseClient, db: Db): Promise<Snapshot> {
  const users = await listAllUsers(admin);
  const ciIds = users.filter((u) => isCiEmail(u.email)).map((u) => u.id);
  const nonCi = users.filter((u) => !isCiEmail(u.email));
  const counts = await asService(db, async (c) => {
    const p = await c.query("select count(*)::int as n from public.profiles where user_id <> all($1::uuid[])", [ciIds]);
    const m = await c.query("select count(*)::int as n from public.pair_members where user_id <> all($1::uuid[])", [ciIds]);
    return { profiles: p.rows[0].n as number, pairMembers: m.rows[0].n as number };
  });
  return { nonCiUsers: nonCi.length, ...counts };
}

export type Ctx = {
  admin: SupabaseClient;
  db: Db;
  runId: string;
  email(n: number | string): string;
  /** 管理APIでテスト用ユーザーを作る（メールは送られない）。後片付けの対象に入る */
  createUser(n: number | string): Promise<{ id: string; email: string; password: string }>;
  track(id: string): void;
};

/**
 * describe の中で呼ぶ。開始時に前の実行の取り残し（決まった形のアドレスだけ）を消して件数を記録し、
 * 終了時（失敗時も）に、この実行で作ったユーザーと取り残しを消して、件数が変わっていないこと・テスト用ユーザーが残っていないことを確かめる。
 */
export function useCiGuard(): Ctx {
  const ctx = { runId: runIdFromEnv(), created: new Set<string>() } as { runId: string; created: Set<string> } & Partial<Ctx>;
  let before: Snapshot;

  // 対象: 決まった形のアドレスのユーザーと、この実行で作ったユーザー（ID で記録。万一アドレスが判定に一致しなくても消す）
  async function deleteCiUsers(admin: SupabaseClient, db: Db): Promise<number> {
    let failed = 0;
    const users = (await listAllUsers(admin)).filter((u) => isCiEmail(u.email) || ctx.created.has(u.id));
    for (const u of users) {
      // 先にDB側（profiles・所属・空になった pair）を消してから、認証側のユーザーを消す（アプリのアカウント削除と同じ順）
      try {
        const { deleteAccount } = await import("@/server/services/account");
        await deleteAccount({ auth: supabaseAuth, db, signup: createSignupPolicy([]) }, u.id);
      } catch {
        const { error } = await admin.auth.admin.deleteUser(u.id);
        if (error) failed++;
      }
    }
    return failed;
  }

  beforeAll(async () => {
    ctx.admin = adminClient();
    ctx.db = createDb(buildDatabaseConnection());
    await deleteCiUsers(ctx.admin, ctx.db); // 前の実行の取り残し
    before = await snapshot(ctx.admin, ctx.db);
  }, 120_000);

  afterAll(async () => {
    if (!ctx.admin || !ctx.db || !before) return; // 準備に失敗したときは、後片付けの対象がない
    const failed = await deleteCiUsers(ctx.admin!, ctx.db!);
    const all = await listAllUsers(ctx.admin!);
    const remain = all.filter((u) => isCiEmail(u.email)).length;
    // 判定（isCiEmail）に頼らず、この実行で作ったユーザーが1人も残っていないことも確かめる
    const createdLeft = all.filter((u) => ctx.created.has(u.id)).length;
    const after = await snapshot(ctx.admin!, ctx.db!);
    await ctx.db!.pool.end();
    // 値そのものではなく、件数だけを出す
    sameNumber(failed, 0, "後片付けに失敗したテスト用ユーザー数");
    sameNumber(remain, 0, "残ったテスト用ユーザー数");
    sameNumber(createdLeft, 0, "この実行で作ったのに残ったユーザー数（判定に一致しないアドレスの検出）");
    sameNumber(after.nonCiUsers, before.nonCiUsers, "テスト用以外のユーザー数");
    sameNumber(after.profiles, before.profiles, "テスト用以外のプロフィール件数");
    sameNumber(after.pairMembers, before.pairMembers, "テスト用以外の所属件数");
  }, 300_000);

  ctx.email = (n) => ciEmail(ctx.runId, n);
  ctx.track = (id) => void ctx.created.add(id);
  ctx.createUser = async (n) => {
    const email = ciEmail(ctx.runId, n); // 判定に一致しない形なら、ここで例外（ユーザーを作らない）
    ok(isCiEmail(email), "テスト用アドレスが後片付けの判定に一致する");
    const { data, error } = await ctx.admin!.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.code ?? error?.name ?? "unknown"}`);
    ctx.created.add(data.user.id);
    return { id: data.user.id, email, password: PASSWORD };
  };
  return ctx as Ctx;
}
