/**
 * 分離（RLS）を迂回できる特権は、このフォルダの中だけに置く（SPEC-000a AC-14）。
 * - DB: ロール `service_role`（RLS を迂回）で動く処理
 * - 認証基盤の管理用の鍵（SUPABASE_SERVICE_ROLE_KEY）を使う処理
 * このフォルダの外から `service_role`・鍵の環境変数名・runPrivileged を参照してはいけない（tests/static-checks が確かめる）。
 * ブラウザ向けのコード（'use client'）からこのフォルダを読み込んではいけない。
 */
import type { PoolClient } from "pg";
import { createClient } from "@supabase/supabase-js";
import type { Db } from "../db/pool";
import { getEnv, supabaseAuthConfig, ConfigError } from "../config";

async function runPrivileged<T>(db: Db, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * ユーザー単位の全データ削除（DB側）。プロフィールと pair の所属を消す。
 * 所属を消した結果メンバーがいなくなった pair は消す。相手が残る pair は変更しない（相手のデータを変えない。解消の扱いは SPEC-003）。
 * 認証基盤上のアカウント本体の削除は deleteAuthUser（同じこのフォルダ）が行い、services/account.ts が両方を順に呼ぶ。
 * 今後 個人データのテーブルを追加したら、ここに削除を足す（app/README.md の手順 4）。
 */
export async function deleteUserData(db: Db, userId: string): Promise<void> {
  await runPrivileged(db, async (c) => {
    await c.query("DELETE FROM public.profiles WHERE user_id = $1", [userId]);
    // LLM 利用記録（SPEC-000b）。月次集計は個人を特定しないので消さない（D-012。合計は変わらない）
    await c.query("DELETE FROM public.llm_usage WHERE user_id = $1", [userId]);
    const mine = await c.query("DELETE FROM public.pair_members WHERE user_id = $1 RETURNING pair_id", [userId]);
    const pairIds: string[] = mine.rows.map((r) => r.pair_id);
    if (pairIds.length) {
      await c.query(
        `DELETE FROM public.pairs p
          WHERE p.id = ANY($1) AND NOT EXISTS (SELECT 1 FROM public.pair_members m WHERE m.pair_id = p.id)`,
        [pairIds],
      );
    }
  });
}

/** テスト用：pair を作って所属を登録する（SPEC-000a 第5章「テスト用の作成手段のみ」。画面・APIからは使わない） */
export async function createPairForTest(db: Db, memberIds: string[], status: "active" | "ended" = "active"): Promise<string> {
  return runPrivileged(db, async (c) => {
    const p = await c.query("INSERT INTO public.pairs (status) VALUES ($1) RETURNING id", [status]);
    const pairId: string = p.rows[0].id;
    for (const id of memberIds) {
      await c.query("INSERT INTO public.pair_members (pair_id, user_id) VALUES ($1, $2)", [pairId, id]);
    }
    return pairId;
  });
}

function adminClient() {
  const cfg = supabaseAuthConfig();
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!cfg || !serviceKey) throw new ConfigError("認証基盤の管理用設定がありません");
  return createClient(cfg.url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

/** 認証基盤上のアカウントを削除する（Supabase の管理API） */
export async function deleteAuthUser(userId: string): Promise<void> {
  const { error } = await adminClient().auth.admin.deleteUser(userId);
  if (error) throw new Error(`auth admin deleteUser failed: ${error.code ?? error.name}`);
}

/**
 * 利用者の全セッションを失効させる（scope: global。全端末からのログアウト。SPEC-000c A-8）。
 * アクセストークンが無効・期限切れだと、認証基盤は拒否する（status 401/403）。失敗は例外にせず結果で返し、アダプタが種類に直す。
 */
export async function revokeAuthSession(accessToken: string): Promise<{ ok: true } | { ok: false; status: number; code: string }> {
  const { error } = await adminClient().auth.admin.signOut(accessToken, "global");
  if (!error) return { ok: true };
  return { ok: false, status: error.status ?? 0, code: error.code ?? error.name };
}
