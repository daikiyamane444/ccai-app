import type { PoolClient } from "pg";
import type { Db } from "./pool";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 利用者の権限でデータ層を呼ぶ。トランザクション内でDBのロールを `authenticated` に切り替え、
 * `request.jwt.claims` に利用者IDを入れる（Supabase の auth.uid() と同じ仕組み）。
 * 以後のSQLは行レベルセキュリティ（RLS）に従う。アプリのデータ読み書きは必ずこの関数か asAnon を通す。
 */
export async function asUser<T>(db: Db, userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(userId)) throw new Error("invalid user id");
  return inRole(db, "authenticated", userId, fn);
}

/** 未ログイン（匿名）の権限。テストと、将来の公開データ用 */
export async function asAnon<T>(db: Db, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return inRole(db, "anon", undefined, fn);
}

async function inRole<T>(
  db: Db,
  role: "authenticated" | "anon",
  userId: string | undefined,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    // ロール名は固定の2種類だけ（引数をそのままSQLに入れない）
    await client.query(role === "authenticated" ? "SET LOCAL ROLE authenticated" : "SET LOCAL ROLE anon");
    if (userId) {
      const claims = JSON.stringify({ sub: userId, role: "authenticated" });
      await client.query("SELECT set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [
        claims,
        userId,
      ]);
    }
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
