// 本物の Supabase との結合テスト（SPEC-000c AC-8〜AC-11、AC-13）。GitHub Actions から手動で起動する（.github/workflows/integration.yml）。
// 失敗時のメッセージに値を出さないため、expect は直接使わず、lib.ts の ok / sameNumber / sameCode / emptyLabels だけを使う（static-checks が確かめる）。
import { describe, it } from "vitest";
import { AuthError, type Tokens } from "@/server/auth";
import { supabaseAuth } from "@/server/auth/supabase";
import { asAnon, asUser } from "@/server/db/context";
import { createProfile } from "@/server/db/profile";
import { createPairForTest } from "@/server/privileged";
import { deleteAccount } from "@/server/services/account";
import { createSignupPolicy } from "@/server/services/signup-policy";
import { asService, PASSWORD, realDeps, requireEnv, useCiGuard } from "./env";
import { emptyLabels, ok, sameCode, sameNumber, tablePrivilegeViolations } from "./lib";

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
      ok(r.tokens.accessToken.length > 20 && r.tokens.refreshToken.length > 5, "登録直後にトークンが返る");
      ok((await supabaseAuth.verify(r.tokens.accessToken))?.id === r.user.id, "登録直後のアクセストークンが有効");
      ok((await supabaseAuth.signIn(email, PASSWORD)).user.id === r.user.id, "登録直後にログインできる");
      sameCode(await codeOf(supabaseAuth.signUp(email, PASSWORD)), "auth:email_taken", "登録済みメールでの再登録");
      sameCode(await codeOf(supabaseAuth.signIn(email, "wrong-password-1")), "auth:invalid_credentials", "誤ったパスワード");
    }, 60_000);
  });

  describe("AC-9 ログアウトでの失効と、リフレッシュトークンの回転", () => {
    // AC-9（v2）1点目: ログアウト後は、親を含めてどのリフレッシュトークンも使えない（第2-D章 理由3 の根拠）。
    // ログイン（t1）→ 1回更新（t2。t1 は「いま有効な t2 の親」になる）→ t2 でログアウト → 猶予（10秒）の内と後の両方で確かめる
    it("ログアウト後は、いまのリフレッシュトークンも、その親も、アクセストークンも使えない（再利用の猶予の内と後）", async () => {
      const u = await ctx.createUser("logout");
      const t1 = (await supabaseAuth.signIn(u.email, u.password)).tokens;
      const r2 = await supabaseAuth.refresh(t1.refreshToken);
      ok(r2 !== null, "ログアウト前の更新が成功");
      const t2 = r2!.tokens;
      ok((await supabaseAuth.verify(t2.accessToken))?.id === u.id, "ログアウト前は有効");

      await supabaseAuth.signOut(t2.accessToken);

      const allRejected = async (when: string) => {
        ok((await supabaseAuth.verify(t2.accessToken)) === null, `${when}: いまのアクセストークンでのユーザー情報の取得は拒否`);
        ok((await supabaseAuth.verify(t1.accessToken)) === null, `${when}: 前のアクセストークンでのユーザー情報の取得は拒否`);
        ok((await supabaseAuth.refresh(t2.refreshToken)) === null, `${when}: いまのリフレッシュトークンでの更新は拒否`);
        ok((await supabaseAuth.refresh(t1.refreshToken)) === null, `${when}: 親のリフレッシュトークンでの更新は拒否`);
      };
      await allRejected("猶予の内（ログアウト直後）");
      await sleep(13_000); // 再利用の猶予（既定10秒）を過ぎてから
      await allRejected("猶予の後");
    }, 90_000);

    it("全端末: 別のセッションも失効する（A-8）", async () => {
      const u = await ctx.createUser("global");
      const pc = await supabaseAuth.signIn(u.email, u.password);
      const phone = await supabaseAuth.signIn(u.email, u.password);
      await supabaseAuth.signOut(pc.tokens.accessToken);
      ok((await supabaseAuth.refresh(phone.tokens.refreshToken)) === null, "別の端末のセッションも失効している");
    }, 60_000);

    // Supabase の仕様（公式ドキュメント「Sessions」）: リフレッシュトークンは原則1回だけ使える。例外は2つ
    //  (1) 再利用の猶予（既定10秒）の間  (2) 「いま有効なトークンの1つ前（親）」の再利用 → いま有効なトークンが返る
    // それ以外の再利用は「漏えいの疑い」として、そのセッションの全リフレッシュトークンが失効する（再利用の検知。既定で有効）。
    // そのため、確かめるのは「2つ以上前（祖父）のトークンの再利用が拒否され、セッション全体が失効すること」。
    // 親の再利用が受け付けられる点は仕様どおりで、SPEC-000c AC-9 の文言との差は戦略担当に確認中（docs/reviews の記録を参照）。
    it("リフレッシュトークンは使うたびに変わり、2つ以上前のトークンの再利用は拒否され、そのセッション全体が失効する", async () => {
      const u = await ctx.createUser("rotate");
      const t1: Tokens = (await supabaseAuth.signIn(u.email, u.password)).tokens;
      const r2 = await supabaseAuth.refresh(t1.refreshToken);
      ok(r2 !== null && r2.tokens.refreshToken !== t1.refreshToken, "1回目の更新でトークンが変わる");
      await sleep(13_000); // 再利用の猶予（既定10秒）を過ぎてから
      const r3 = await supabaseAuth.refresh(r2!.tokens.refreshToken);
      ok(r3 !== null && r3.tokens.refreshToken !== r2!.tokens.refreshToken, "2回目の更新でトークンが変わる");
      await sleep(13_000);
      ok((await supabaseAuth.refresh(t1.refreshToken)) === null, "2つ以上前のリフレッシュトークンの再利用は拒否");
      ok((await supabaseAuth.refresh(r3!.tokens.refreshToken)) === null, "再利用の検知で、いま有効だったリフレッシュトークンも失効");
    }, 90_000);
  });

  describe("AC-10 DB接続（最小権限ロール・プーラー・権限一覧・Data API）", () => {
    it("アプリ用ロールで接続し、SET LOCAL ROLE authenticated / service_role が通る", async () => {
      const who = await ctx.db.pool.query("select current_user::text as u");
      ok(String(who.rows[0].u).startsWith("ccai_app"), "アプリ用ロールで接続している");
      for (const role of ["authenticated", "service_role"]) {
        const c = await ctx.db.pool.connect();
        try {
          await c.query("BEGIN");
          await c.query(`SET LOCAL ROLE ${role}`);
          const r = await c.query("select current_user::text as u");
          ok(r.rows[0].u === role, `SET LOCAL ROLE ${role} が効く`);
          await c.query("COMMIT");
        } finally {
          c.release();
        }
      }
    }, 60_000);

    it("SET ROLE なしでテーブルを読むと権限エラー（42501）", async () => {
      sameCode(await codeOf(ctx.db.pool.query("select * from public.profiles")), "42501", "SET ROLE なしの読み取り");
      sameCode(await codeOf(ctx.db.pool.query("delete from public.profiles")), "42501", "SET ROLE なしの削除");
    }, 60_000);

    it("暗号化して接続している（クライアントからプーラーまで）", async () => {
      const c = await ctx.db.pool.connect();
      try {
        const encrypted = (c as unknown as { connection: { stream: { encrypted?: boolean } } }).connection.stream.encrypted === true;
        ok(encrypted, "暗号化した接続");
      } finally {
        c.release();
      }
    }, 60_000);

    it("接続方式（プーラー）でも SET LOCAL が期待どおり効き、次の処理に漏れない（20回、接続の使い回しをまたいで）", async () => {
      const a = await ctx.createUser("setlocal-a");
      for (let i = 0; i < 20; i++) {
        const inside = await asUser(ctx.db, a.id, (c) => c.query("select auth.uid()::text as uid, current_user::text as u"));
        ok(inside.rows[0].uid === a.id && inside.rows[0].u === "authenticated", "asUser の中");
        const outside = await ctx.db.pool.query("select current_user::text as u, coalesce(current_setting('request.jwt.claims', true), '') as claims");
        ok(String(outside.rows[0].u).startsWith("ccai_app") && outside.rows[0].claims === "", "トランザクションの外に漏れない");
        const anon = await asAnon(ctx.db, (c) => c.query("select auth.uid()::text as uid, current_user::text as u"));
        ok(anon.rows[0].uid === null && anon.rows[0].u === "anon", "asAnon の中");
      }
    }, 120_000);

    it("anon / authenticated に、マイグレーションが許可した以外のテーブル権限がない", async () => {
      const violations = await asService(ctx.db, (c) => tablePrivilegeViolations(c));
      emptyLabels(violations, "許可外の権限");
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
      ok(withToken.status !== 200 || onlyOwn, `ログイン済みのREST（status ${withToken.status}）`);
      ok(!(withToken.rows?.some((r) => r.user_id === b.id) ?? false), "ログイン済みのRESTで他人の行が出ない");
      const anon = await call({});
      ok(anon.status !== 200 || (anon.rows?.length ?? 0) === 0, `匿名のREST（status ${anon.status}）`);
    }, 90_000);
  });

  describe("AC-11 削除の連鎖", () => {
    it("管理APIでの削除で auth.users から profiles・pair_members まで消え、他のユーザーの行は変わらない。アプリの削除処理でも同じ", async () => {
      const [a, b, c] = [await ctx.createUser("del-a"), await ctx.createUser("del-b"), await ctx.createUser("del-c")];
      for (const u of [a, b, c]) await createProfile(ctx.db, u.id, "X");
      await createPairForTest(ctx.db, [a.id, b.id]);
      const same = (x: { profiles: number; members: number }, y: { profiles: number; members: number }, label: string) => {
        sameNumber(x.profiles, y.profiles, `${label}: プロフィール件数`);
        sameNumber(x.members, y.members, `${label}: 所属件数`);
      };
      const count = (ids: string[]) =>
        asService(ctx.db, async (cl) => ({
          profiles: (await cl.query("select count(*)::int as n from public.profiles where user_id = any($1::uuid[])", [ids])).rows[0].n as number,
          members: (await cl.query("select count(*)::int as n from public.pair_members where user_id = any($1::uuid[])", [ids])).rows[0].n as number,
        }));
      same(await count([a.id, b.id, c.id]), { profiles: 3, members: 2 }, "削除前");

      // 管理APIで A を削除（権限エラーなく、連鎖で消える）
      const del = await ctx.admin.auth.admin.deleteUser(a.id);
      ok(!del.error, "管理APIでの削除が成功");
      same(await count([a.id]), { profiles: 0, members: 0 }, "管理APIで削除したA");
      same(await count([b.id, c.id]), { profiles: 2, members: 1 }, "BとC"); // B と C は変わらない

      // アプリのアカウント削除処理で B を削除
      await deleteAccount({ auth: supabaseAuth, db: ctx.db, signup: createSignupPolicy([]) }, b.id);
      same(await count([b.id]), { profiles: 0, members: 0 }, "アプリで削除したB");
      same(await count([c.id]), { profiles: 1, members: 0 }, "C"); // C は変わらない
      const left = await asService(ctx.db, async (cl) => (await cl.query("select count(*)::int as n from public.pairs p where not exists (select 1 from public.pair_members m where m.pair_id = p.id)")).rows[0].n as number);
      sameNumber(left, 0, "メンバーのいない pair の数");
    }, 120_000);
  });
});
