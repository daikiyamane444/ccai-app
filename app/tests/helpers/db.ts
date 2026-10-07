import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { inject } from "vitest";
import { createDb, type Db } from "@/server/db/pool";
import type { AuthUser } from "@/server/auth";

export type TestDb = {
  /** アプリと同じ接続（アプリのコードはこれ経由で asUser / asAnon / 特権処理を使う） */
  db: Db;
  /** 検証用の管理者接続（RLS を受けない。テストの準備と結果の確認だけに使う） */
  admin: Pool;
  mirror: { insert(u: AuthUser): Promise<void>; remove(id: string): Promise<void> };
  close(): Promise<void>;
};

/** テストファイルごとに、テンプレートDB（shim＋マイグレーション適用済み）から専用のDBを作る */
export async function createTestDb(): Promise<TestDb> {
  const base = inject("pgBaseUrl");
  const name = `t_${randomUUID().replace(/-/g, "")}`;
  const c = new Client({ connectionString: `${base}/postgres` });
  await c.connect();
  await c.query(`CREATE DATABASE ${name} TEMPLATE ccai_template`);
  await c.end();
  const url = `${base}/${name}`;
  const db = createDb(url);
  const admin = new Pool({ connectionString: url, max: 3 });
  return {
    db,
    admin,
    mirror: {
      insert: async (u) => {
        await admin.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [u.id, u.email]);
      },
      remove: async (id) => {
        await admin.query("DELETE FROM auth.users WHERE id = $1", [id]);
      },
    },
    close: async () => {
      await db.pool.end();
      await admin.end();
      const d = new Client({ connectionString: `${base}/postgres` });
      await d.connect();
      await d.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await d.end();
    },
  };
}

/** 認証基盤のアカウント（auth.users）を作る。本物の Supabase ではサインアップで作られる行 */
export async function createAuthUser(t: TestDb, email?: string): Promise<string> {
  const id = randomUUID();
  await t.admin.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [id, email ?? `${id.slice(0, 8)}@example.test`]);
  return id;
}

export async function insertProfile(t: TestDb, userId: string, displayName: string | null = "テスト"): Promise<void> {
  await t.admin.query("INSERT INTO public.profiles (user_id, display_name, age_confirmed_at) VALUES ($1, $2, now())", [userId, displayName]);
}
