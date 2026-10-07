// 本物の Supabase との結合テスト（SPEC-000c AC-8〜AC-11、AC-13）。GitHub Actions から手動で起動する（.github/workflows/integration.yml）。
// 失敗時のメッセージに値を出さないため、expect には真偽・件数・コードだけを渡す。
import { describe, expect, it } from "vitest";
import { AuthError, type Tokens } from "@/server/auth";
import { supabaseAuth } from "@/server/auth/supabase";
import { asAnon, asUser } from "@/server/db/context";
import { createProfile } from "@/server/db/profile";
import { createPairForTest } from "@/server/privileged";
import { deleteAccount } from "@/server/services/account";
import { createSignupPolicy } from "@/server/services/signup-policy";
import { asService, PASSWORD, realDeps, requireEnv, useCiGuard } from "./env";
import { tablePrivilegeViolations } from "./lib";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof AuthError ? `auth:${e.code}` : ((e as { code?: string }).code ?? "error");
  }
};

describe("本物の Supabase（結合テスト）", () => {
  const ctx = useCiGuard();

  describe("AC-8 登録・ログイン（メール確認オフ）と、登録済みメールの応答", () => {
    it("新規登録の直後にセッションが返り、ログインできる。同じメールでの再登録は email_taken", async () => {
      const email = ctx.email("signup");
      const r = await supabaseAuth.signUp(email, PASSWORD); // メール確認がオンだと session が返らず unexpected になる
      ctx.track(r.user.id);
      expect(r.tokens.accessToken.length > 20 && r.tokens.refreshToken.length > 5).toBe(true);
      expect((await supabaseAuth.verify(r.tokens.accessToken))?.id === r.user.id).toBe(true);
      expect((await supabaseAuth.signIn(email, PASSWORD)).user.id === r.user.id).toBe(true);
      expect(await codeOf(supabaseAuth.signUp(email, PASSWORD))).toBe("auth:email_taken");
      expect(await codeOf(supabaseAuth.signIn(email, "wrong-password-1"))).toBe("auth:invalid_credentials");
    }, 60_000);
  });

  describe("AC-9 ログアウトでの失効と、リフレッシュトークンの回転", () => {
    it("ログアウト後は、ユーザー情報の取得も旧リフレッシュトークンでの更新もできない", async () => {
      const u = await ctx.createUser("logout");
      const t = await supabaseAuth.signIn(u.email, u.password);
      expect((await supabaseAuth.verify(t.tokens.accessToken))?.id === u.id).toBe(true);
      await supabaseAuth.signOut(t.tokens.accessToken);
      expect(await supabaseAuth.verify(t.tokens.accessToken)).toBeNull();
      expect(await supabaseAuth.refresh(t.tokens.refreshToken)).toBeNull();
    }, 60_000);

    it("全端末: 別のセッションも失効する（A-8）", async () => {
      const u = await ctx.createUser("global");
      const pc = await supabaseAuth.signIn(u.email, u.password);
      const phone = await supabaseAuth.signIn(u.email, u.password);
      await supabaseAuth.signOut(pc.tokens.accessToken);
      expect(await supabaseAuth.refresh(phone.tokens.refreshToken)).toBeNull();
    }, 60_000);

    it("リフレッシュトークンは1回で回転し、使用済みの再利用は（再利用の猶予時間のあと）拒否される", async () => {
      const u = await ctx.createUser("rotate");
      const t1: Tokens = (await supabaseAuth.signIn(u.email, u.password)).tokens;
      const r2 = await supabaseAuth.refresh(t1.refreshToken);
      expect(r2 !== null && r2.tokens.refreshToken !== t1.refreshToken).toBe(true);
      await sleep(13_000); // Supabase の「再利用の猶予」の既定は10秒。その後の再利用は拒否される
      expect(await supabaseAuth.refresh(t1.refreshToken)).toBeNull();
    }, 60_000);
  });

  describe("AC-10 DB接続（最小権限ロール・プーラー・権限一覧・Data API）", () => {
    it("アプリ用ロールで接続し、SET LOCAL ROLE authenticated / service_role が通る", async () => {
      const who = await ctx.db.pool.query("select current_user::text as u");
      expect(String(who.rows[0].u).startsWith("ccai_app")).toBe(true);
      for (const role of ["authenticated", "service_role"]) {
        const c = await ctx.db.pool.connect();
        try {
          await c.query("BEGIN");
          await c.query(`SET LOCAL ROLE ${role}`);
          const r = await c.query("select current_user::text as u");
          expect(r.rows[0].u).toBe(role);
          await c.query("COMMIT");
        } finally {
          c.release();
        }
      }
    }, 60_000);

    it("SET ROLE なしでテーブルを読むと権限エラー（42501）", async () => {
      expect(await codeOf(ctx.db.pool.query("select * from public.profiles"))).toBe("42501");
      expect(await codeOf(ctx.db.pool.query("delete from public.profiles"))).toBe("42501");
    }, 60_000);

    it("暗号化して接続している（クライアントからプーラーまで）", async () => {
      const c = await ctx.db.pool.connect();
      try {
        const encrypted = (c as unknown as { connection: { stream: { encrypted?: boolean } } }).connection.stream.encrypted === true;
        expect(encrypted).toBe(true);
      } finally {
        c.release();
      }
    }, 60_000);

    it("接続方式（プーラー）でも SET LOCAL が期待どおり効き、次の処理に漏れない（20回、接続の使い回しをまたいで）", async () => {
      const a = await ctx.createUser("setlocal-a");
      for (let i = 0; i < 20; i++) {
        const inside = await asUser(ctx.db, a.id, (c) => c.query("select auth.uid()::text as uid, current_user::text as u"));
        expect(inside.rows[0].uid === a.id && inside.rows[0].u === "authenticated").toBe(true);
        const outside = await ctx.db.pool.query("select current_user::text as u, coalesce(current_setting('request.jwt.claims', true), '') as claims");
        expect(String(outside.rows[0].u).startsWith("ccai_app") && outside.rows[0].claims === "").toBe(true);
        const anon = await asAnon(ctx.db, (c) => c.query("select auth.uid()::text as uid, current_user::text as u"));
        expect(anon.rows[0].uid === null && anon.rows[0].u === "anon").toBe(true);
      }
    }, 120_000);

    it("anon / authenticated に、マイグレーションが許可した以外のテーブル権限がない", async () => {
      const violations = await asService(ctx.db, (c) => tablePrivilegeViolations(c));
      expect(violations, `許可外の権限（${violations.length}件）: ${violations.join(" / ")}`).toEqual([]);
    }, 60_000);

    it("ログイン済みユーザーが自分のトークンで REST の profiles を直接呼んでも、拒否されるか、自分の行しか返らない", async () => {
      const env = requireEnv("SUPABASE_URL", "SUPABASE_ANON_KEY");
      const a = await ctx.createUser("rest-a");
      const b = await ctx.createUser("rest-b");
      await createProfile(ctx.db, a.id, "A");
      await createProfile(ctx.db, b.id, "B");
      const t = await supabaseAuth.signIn(a.email, a.password);
      const call = async (headers: Record<string, string>) => {
        const res = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?select=user_id`, { headers: { apikey: env.SUPABASE_ANON_KEY, ...headers } });
        const rows = res.status === 200 ? ((await res.json()) as { user_id: string }[]) : null;
        return { status: res.status, rows };
      };
      const withToken = await call({ Authorization: `Bearer ${t.tokens.accessToken}` });
      const onlyOwn = withToken.rows !== null && withToken.rows.every((r) => r.user_id === a.id);
      expect(withToken.status !== 200 || onlyOwn, `ログイン済みのREST（status ${withToken.status}）`).toBe(true);
      expect(withToken.rows?.some((r) => r.user_id === b.id) ?? false).toBe(false);
      const anon = await call({});
      expect(anon.status !== 200 || (anon.rows?.length ?? 0) === 0, `匿名のREST（status ${anon.status}）`).toBe(true);
    }, 90_000);
  });

  describe("AC-11 削除の連鎖", () => {
    it("管理APIでの削除で auth.users から profiles・pair_members まで消え、他のユーザーの行は変わらない。アプリの削除処理でも同じ", async () => {
      const [a, b, c] = [await ctx.createUser("del-a"), await ctx.createUser("del-b"), await ctx.createUser("del-c")];
      for (const u of [a, b, c]) await createProfile(ctx.db, u.id, "X");
      await createPairForTest(ctx.db, [a.id, b.id]);
      const count = (ids: string[]) =>
        asService(ctx.db, async (cl) => ({
          profiles: (await cl.query("select count(*)::int as n from public.profiles where user_id = any($1::uuid[])", [ids])).rows[0].n as number,
          members: (await cl.query("select count(*)::int as n from public.pair_members where user_id = any($1::uuid[])", [ids])).rows[0].n as number,
        }));
      expect(await count([a.id, b.id, c.id])).toEqual({ profiles: 3, members: 2 });

      // 管理APIで A を削除（権限エラーなく、連鎖で消える）
      const del = await ctx.admin.auth.admin.deleteUser(a.id);
      expect(del.error?.code ?? null).toBeNull();
      expect(await count([a.id])).toEqual({ profiles: 0, members: 0 });
      expect(await count([b.id, c.id])).toEqual({ profiles: 2, members: 1 }); // B と C は変わらない

      // アプリのアカウント削除処理で B を削除
      await deleteAccount({ auth: supabaseAuth, db: ctx.db, signup: createSignupPolicy([]) }, b.id);
      expect(await count([b.id])).toEqual({ profiles: 0, members: 0 });
      expect(await count([c.id])).toEqual({ profiles: 1, members: 0 }); // C は変わらない
      const left = await asService(ctx.db, async (cl) => (await cl.query("select count(*)::int as n from public.pairs p where not exists (select 1 from public.pair_members m where m.pair_id = p.id)")).rows[0].n as number);
      expect(left, "メンバーのいない pair の数").toBe(0);
    }, 120_000);
  });
});
