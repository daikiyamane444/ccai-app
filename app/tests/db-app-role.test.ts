// SPEC-000c AC-6: アプリ用の最小権限ロール（ccai_app）。テーブル権限も BYPASSRLS もない。SET ROLE だけができる
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { inject } from "vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser } from "@/server/db/context";
import { createAuthUser, createTestDb, insertProfile, type TestDb } from "./helpers/db";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? "error";
  }
}

describe("アプリ用ロール ccai_app（AC-6）", () => {
  let t: TestDb;
  let userId: string;
  beforeAll(async () => {
    t = await createTestDb();
    userId = await createAuthUser(t);
    await insertProfile(t, userId, "ほんにん");
  });
  afterAll(async () => {
    await t.close();
  });

  it("テストのアプリ接続は ccai_app で、スーパーユーザー・BYPASSRLS・作成権限がない", async () => {
    const who = await t.db.pool.query("select current_user as u, session_user as s");
    expect(who.rows[0]).toEqual({ u: "ccai_app", s: "ccai_app" });
    const r = await t.admin.query("select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin, rolinherit from pg_roles where rolname = 'ccai_app'");
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolcanlogin: true, rolinherit: false });
  });

  it("SET ROLE なしで public の表を読み書きすると、権限エラー（42501）で失敗する", async () => {
    const p = t.db.pool;
    expect(await code(p.query("select * from public.profiles"))).toBe("42501");
    expect(await code(p.query("insert into public.profiles (user_id, age_confirmed_at) values (gen_random_uuid(), now())"))).toBe("42501");
    expect(await code(p.query("update public.profiles set display_name = 'x'"))).toBe("42501");
    expect(await code(p.query("delete from public.profiles"))).toBe("42501");
    expect(await code(p.query("select * from public.pairs"))).toBe("42501");
    expect(await code(p.query("select * from public.pair_members"))).toBe("42501");
  });

  it("どの表にも、直接の権限がない（public の全テーブル×全権限）", async () => {
    const r = await t.admin.query(`
      select c.relname, p.priv, has_table_privilege('ccai_app', c.oid, p.priv) as ok
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) as p(priv)
       where c.relkind in ('r','p','v','m')`);
    expect(r.rowCount).toBeGreaterThan(0);
    expect(r.rows.filter((x) => x.ok)).toEqual([]);
  });

  it("asUser / asAnon / 特権部品では、従来どおり動く", async () => {
    const own = await asUser(t.db, userId, (c) => c.query("select display_name from public.profiles where user_id = $1", [userId]));
    expect(own.rows[0].display_name).toBe("ほんにん");
    const anon = await asAnon(t.db, (c) => c.query("select 1 from public.profiles").catch((e) => ({ rowCount: 0, code: e.code })));
    expect(anon.rowCount).toBe(0);
    const { deleteUserData } = await import("@/server/privileged");
    const other = await createAuthUser(t);
    await insertProfile(t, other, "ほか");
    await deleteUserData(t.db, other); // service_role に切り替えて削除する特権部品
    expect((await t.admin.query("select count(*)::int as n from public.profiles")).rows[0].n).toBe(1);
  });

  it("許されていないロール（postgres など）には SET ROLE できない", async () => {
    expect(await code(t.db.pool.query("set role postgres"))).toBe("42501");
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(await code(t.db.pool.query(`set role ${role}`))).toBe("ok");
    }
  });
});

describe("マイグレーションのSQLとパスワード設定のSQL", () => {
  const migration = readFileSync(join(appDir, "supabase/migrations/20261008000001_app_role.sql"), "utf8");
  const script = readFileSync(join(appDir, "supabase/manual/set-app-role-password.sql"), "utf8");
  const code_ = (sql: string) => sql.replace(/--.*$/gm, "");

  it("マイグレーションにパスワードが書かれていない（パスワード指定の構文がない）", () => {
    expect(code_(migration)).not.toMatch(/password/i);
    expect(code_(migration)).toMatch(/nobypassrls/i);
  });

  it("パスワード設定のSQLに、固定のパスワードがない（DBの中で作る）", () => {
    expect(code_(script)).not.toMatch(/password\s+'/i);
    expect(code_(script)).toMatch(/gen_random_uuid/);
  });

  it("パスワード設定のSQLを実行すると、新しいパスワードが1回表示され、そのパスワードでログインできる。再実行すると変わる", async () => {
    const base = inject("pgBaseUrl");
    const role = "ccai_pwtest";
    const admin = new Client({ connectionString: `${base}/postgres` });
    await admin.connect();
    await admin.query(`drop role if exists ${role}`);
    await admin.query(`create role ${role} login noinherit nobypassrls`);
    const sql = script.replace(/ccai_app/g, role);
    // 画面（SQL Editor）と同じく、複数の文を一度に実行する
    const res = (await admin.query(sql)) as unknown as { rows: Record<string, string>[] } | { rows: Record<string, string>[] }[];
    const last = Array.isArray(res) ? res[res.length - 1] : res;
    const pw1 = Object.values(last.rows[0])[0];
    expect(pw1).toMatch(/^[0-9a-f]{64}$/);

    const login = async (pw: string) => {
      const c = new Client({ connectionString: `${base.replace("postgres:ccai_test@", `${role}:${pw}@`)}/postgres` });
      try {
        await c.connect();
        const r = await c.query("select current_user as u");
        await c.end();
        return r.rows[0].u as string;
      } catch (e) {
        return `error:${(e as { code?: string }).code}`;
      }
    };
    expect(await login(pw1)).toBe(role);

    const res2 = (await admin.query(sql)) as unknown as { rows: Record<string, string>[] } | { rows: Record<string, string>[] }[];
    const last2 = Array.isArray(res2) ? res2[res2.length - 1] : res2;
    const pw2 = Object.values(last2.rows[0])[0];
    expect(pw2).not.toBe(pw1);
    expect(await login(pw1)).toMatch(/^error:/);
    expect(await login(pw2)).toBe(role);
    await admin.query(`drop role ${role}`);
    await admin.end();
  });
});
