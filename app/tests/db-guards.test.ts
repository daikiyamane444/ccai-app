// 将来の個人データのテーブルが「RLS有効・anon に権限なし」を満たしているかを毎回確かめる番人（app/README.md の手順2）
// ＋ アプリのデータ層が本当に利用者の権限（RLSの対象）で動いていることの確認
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser } from "@/server/db/context";
import { createAuthUser, createTestDb, insertProfile, type TestDb } from "./helpers/db";

describe("データ層の番人", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("public スキーマの全テーブルで RLS が有効", async () => {
    const r = await t.admin.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity`,
    );
    expect(r.rows.map((x) => x.relname)).toEqual([]);
  });

  it("anon ロールに、public スキーマのどのテーブルへの権限もない", async () => {
    const r = await t.admin.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'anon' AND table_schema = 'public'`,
    );
    expect(r.rows).toEqual([]);
  });

  it("authenticated に DELETE 権限がない（削除は全データ削除の処理だけ）", async () => {
    const r = await t.admin.query(
      `SELECT table_name FROM information_schema.role_table_grants
        WHERE grantee = 'authenticated' AND table_schema = 'public' AND privilege_type = 'DELETE'`,
    );
    expect(r.rows).toEqual([]);
  });

  it("asUser は authenticated ロールで動き、auth.uid() が利用者IDになる", async () => {
    const u = await createAuthUser(t);
    const r = await asUser(t.db, u, (c) => c.query("SELECT current_user AS role, auth.uid() AS uid"));
    expect(r.rows[0]).toEqual({ role: "authenticated", uid: u });
  });

  it("asAnon は anon ロールで動き、auth.uid() は NULL", async () => {
    const r = await asAnon(t.db, (c) => c.query("SELECT current_user AS role, auth.uid() AS uid"));
    expect(r.rows[0]).toEqual({ role: "anon", uid: null });
  });

  it("同じ接続で RLS を迂回できる管理者接続とは別物（管理者は他人の行が見え、利用者は見えない）", async () => {
    const a = await createAuthUser(t);
    const b = await createAuthUser(t);
    await insertProfile(t, a, "Aの名前");
    expect((await t.admin.query("SELECT 1 FROM public.profiles WHERE user_id = $1", [a])).rowCount).toBe(1);
    expect((await asUser(t.db, b, (c) => c.query("SELECT 1 FROM public.profiles WHERE user_id = $1", [a]))).rowCount).toBe(0);
  });

  it("利用者は age_confirmed_at を変更できない／自分の表示名は更新できる", async () => {
    const a = await createAuthUser(t);
    await insertProfile(t, a, "旧");
    await expect(asUser(t.db, a, (c) => c.query("UPDATE public.profiles SET age_confirmed_at = now() WHERE user_id = $1", [a]))).rejects.toThrow(/permission denied/);
    const ok = await asUser(t.db, a, (c) => c.query("UPDATE public.profiles SET display_name = '新' WHERE user_id = $1", [a]));
    expect(ok.rowCount).toBe(1);
  });

  it("表示名は21文字以上を拒否する（データ層の制約）", async () => {
    const a = await createAuthUser(t);
    await expect(
      t.admin.query("INSERT INTO public.profiles (user_id, display_name, age_confirmed_at) VALUES ($1, $2, now())", [a, "あ".repeat(21)]),
    ).rejects.toThrow(/check/);
  });
});

describe("テスト用DBの文字コード", () => {
  it("UTF-8（本物の Supabase と同じ。日本語の文字数制限が文字単位で効く）", async () => {
    const t = await createTestDb();
    try {
      const r = await t.admin.query("SHOW server_encoding");
      expect(r.rows[0].server_encoding).toBe("UTF8");
    } finally {
      await t.close();
    }
  });
});
