// AC-4: 18歳以上のチェックなしでは登録できない／チェックありで登録されホームへ／連打しても1件だけ
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleMe, handleRegister } from "@/server/handlers";
import { MSG } from "@/server/services/messages";
import { cookieFrom, get, makeDeps, post, validRegistration } from "./helpers/app";
import { createTestDb, type TestDb } from "./helpers/db";

describe("新規登録（AC-4）", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  const count = async () => ({
    users: (await t.admin.query("SELECT count(*)::int AS n FROM auth.users")).rows[0].n as number,
    profiles: (await t.admin.query("SELECT count(*)::int AS n FROM public.profiles")).rows[0].n as number,
  });

  it("「18歳以上です」にチェックがないと登録されない（アカウントもプロフィールもできない）", async () => {
    const deps = makeDeps(t);
    for (const ageConfirmed of [false, undefined, "on", "true", 1]) {
      const res = await handleRegister(post("/api/auth/register", { ...validRegistration, ageConfirmed }), deps);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.fieldErrors.ageConfirmed).toBe(MSG.ageRequired);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(deps.auth.accountCount()).toBe(0);
    expect(await count()).toEqual({ users: 0, profiles: 0 });
  });

  it("チェックすると登録され、セッションが発行されてホームの情報（表示名）が取れる", async () => {
    const deps = makeDeps(t);
    const res = await handleRegister(post("/api/auth/register", validRegistration), deps);
    expect(res.status).toBe(201);
    const cookie = cookieFrom(res);
    expect(cookie).toBeTruthy();
    const me = await handleMe(get("/api/me", cookie), deps);
    expect(me.status).toBe(200);
    const body = await me.json();
    expect(body.profile.displayName).toBe("たろう");
    expect(body.user.email).toBe("user@example.test");
    // 年齢確認日時が記録されている
    const row = (await t.admin.query("SELECT age_confirmed_at FROM public.profiles")).rows[0];
    expect(row.age_confirmed_at).toBeInstanceOf(Date);
  });

  it("登録ボタンを連続で押しても（同時に5回）アカウントは1件だけ", async () => {
    const t2 = await createTestDb();
    try {
      const deps = makeDeps(t2, { delayMs: 15 });
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          handleRegister(post("/api/auth/register", { ...validRegistration, email: "dup@example.test" }), deps),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
      expect(deps.auth.accountCount()).toBe(1);
      expect((await t2.admin.query("SELECT count(*)::int AS n FROM auth.users")).rows[0].n).toBe(1);
      expect((await t2.admin.query("SELECT count(*)::int AS n FROM public.profiles")).rows[0].n).toBe(1);
    } finally {
      await t2.close();
    }
  });

  it("登録済みのメールアドレスでの登録は「登録済み」と分かる応答（Q-P9 仮決定）。既存アカウントにログインされず、情報も出ない", async () => {
    const deps = makeDeps(t);
    await handleRegister(post("/api/auth/register", { ...validRegistration, email: "taken@example.test", displayName: "既存の人" }), deps);
    const res = await handleRegister(post("/api/auth/register", { ...validRegistration, email: "TAKEN@example.test", displayName: "別人" }), deps);
    expect(res.status).toBe(409);
    expect(res.headers.get("set-cookie")).toBeNull(); // セッションは発行されない
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("既存の人");
    expect(text).not.toContain("token");
  });

  it("入力の不備は該当欄ごとのエラーになる（空、形式誤り、短いパスワード、21文字の表示名）", async () => {
    const deps = makeDeps(t);
    const res = await handleRegister(
      post("/api/auth/register", { email: "not-an-email", password: "short", displayName: "あ".repeat(21), ageConfirmed: true }),
      deps,
    );
    expect(res.status).toBe(400);
    const { fieldErrors } = await res.json();
    expect(fieldErrors.email).toBe(MSG.emailFormat);
    expect(fieldErrors.password).toBe(MSG.passwordShort);
    expect(fieldErrors.displayName).toBe(MSG.nameLong);
    const empty = await (await handleRegister(post("/api/auth/register", {}), deps)).json();
    expect(empty.fieldErrors.email).toBe(MSG.required);
    expect(empty.fieldErrors.password).toBe(MSG.required);
  });

  it("表示名は任意（空なら未設定）。20文字ちょうどは登録できる", async () => {
    const deps = makeDeps(t);
    const r1 = await handleRegister(post("/api/auth/register", { ...validRegistration, email: "noname@example.test", displayName: "  " }), deps);
    expect(r1.status).toBe(201);
    const r2 = await handleRegister(post("/api/auth/register", { ...validRegistration, email: "name20@example.test", displayName: "あ".repeat(20) }), deps);
    expect(r2.status).toBe(201);
    const names = (await t.admin.query("SELECT display_name FROM public.profiles p JOIN auth.users u ON u.id = p.user_id WHERE u.email IN ('noname@example.test','name20@example.test') ORDER BY u.email")).rows;
    expect(names[0].display_name).toBe("あ".repeat(20));
    expect(names[1].display_name).toBeNull();
  });

  it("JSON 以外の送信は拒否する（他サイトのフォームからの登録を防ぐ）", async () => {
    const deps = makeDeps(t);
    const res = await handleRegister(post("/api/auth/register", "email=a%40b.c&password=xxxxxxxx", undefined, "application/x-www-form-urlencoded"), deps);
    expect(res.status).toBe(415);
    const bad = await handleRegister(post("/api/auth/register", "{not json"), deps);
    expect(bad.status).toBe(400);
  });

  it("プロフィールの作成に失敗したら、できかけのアカウントを残さない", async () => {
    const t3 = await createTestDb();
    try {
      const deps = makeDeps(t3);
      // プロフィール作成を必ず失敗させる（テーブルを一時的に使えなくする）
      await t3.admin.query("ALTER TABLE public.profiles RENAME TO profiles_off");
      const res = await handleRegister(post("/api/auth/register", { ...validRegistration, email: "orphan@example.test" }), deps);
      expect(res.status).toBe(500);
      expect(deps.auth.hasAccount("orphan@example.test")).toBe(false);
      expect((await t3.admin.query("SELECT count(*)::int AS n FROM auth.users")).rows[0].n).toBe(0);
    } finally {
      await t3.close();
    }
  });

  it("認証基盤が不調のときは通信失敗の文言（503）", async () => {
    const deps = makeDeps(t);
    deps.auth.unavailable = true;
    const res = await handleRegister(post("/api/auth/register", { ...validRegistration, email: "net@example.test" }), deps);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(MSG.network);
  });
});
