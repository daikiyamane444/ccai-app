// AC-5（ログイン）、AC-6（未ログインの保護）、AC-7（ログアウト後）、AC-8（cookie）
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleLogin, handleLogout, handleMe, handleRefresh, handleRegister } from "@/server/handlers";
import { MSG } from "@/server/services/messages";
import { SESSION_COOKIE, decodeSession, resolveSession, sessionCookieHeader } from "@/server/session";
import { cookieFrom, get, makeDeps, post, validRegistration } from "./helpers/app";
import { createTestDb, type TestDb } from "./helpers/db";

describe("ログイン・セッション", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  async function registered() {
    const deps = makeDeps(t);
    await handleRegister(post("/api/auth/register", { ...validRegistration, email: `u${Math.random().toString(36).slice(2)}@example.test` }), deps);
    return deps;
  }

  describe("AC-5 ログイン", () => {
    it("正しい情報でログインできる（セッションが発行され、ホームの情報が取れる）", async () => {
      const deps = makeDeps(t);
      await handleRegister(post("/api/auth/register", { ...validRegistration, email: "login@example.test" }), deps);
      const res = await handleLogin(post("/api/auth/login", { email: "Login@Example.test", password: validRegistration.password }), deps);
      expect(res.status).toBe(200);
      const cookie = cookieFrom(res);
      expect(cookie).toBeTruthy();
      expect((await handleMe(get("/api/me", cookie), deps)).status).toBe(200);
    });

    it("存在しないアカウントと誤ったパスワードで、同じ文言・同じ状態コード・同じ本文", async () => {
      const deps = makeDeps(t);
      await handleRegister(post("/api/auth/register", { ...validRegistration, email: "exists@example.test" }), deps);
      const wrongPw = await handleLogin(post("/api/auth/login", { email: "exists@example.test", password: "wrong-password-1" }), deps);
      const noUser = await handleLogin(post("/api/auth/login", { email: "nobody@example.test", password: "wrong-password-1" }), deps);
      expect(wrongPw.status).toBe(401);
      expect(noUser.status).toBe(401);
      const a = await wrongPw.json();
      const b = await noUser.json();
      expect(a).toEqual(b);
      expect(a.error).toBe(MSG.loginFailed);
      expect(wrongPw.headers.get("set-cookie")).toBeNull();
      expect(noUser.headers.get("set-cookie")).toBeNull();
    });

    it("入力が空でも、同じ文言（アカウントの有無や形式を漏らさない）", async () => {
      const deps = makeDeps(t);
      const res = await handleLogin(post("/api/auth/login", { email: "", password: "" }), deps);
      expect((await res.json()).error).toBe(MSG.loginFailed);
    });

    it("認証基盤が不調なら、通信失敗の文言（503）で、誤りの文言とは区別する", async () => {
      const deps = makeDeps(t);
      deps.auth.unavailable = true;
      const res = await handleLogin(post("/api/auth/login", { email: "a@example.test", password: "password-1" }), deps);
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe(MSG.network);
    });
  });

  describe("AC-6 未ログインの保護", () => {
    it("cookie なしで保護された API を呼ぶと 401。本文にユーザーのデータを含まない", async () => {
      const deps = await registered(); // 別のユーザーが存在していても漏れない
      const res = await handleMe(get("/api/me"), deps);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: MSG.unauthorized });
    });

    it("壊れた cookie・知らないトークンも 401（cookie は消す指示を返す）", async () => {
      const deps = await registered();
      for (const c of [`${SESSION_COOKIE}=%%%`, `${SESSION_COOKIE}=${Buffer.from('{"a":"x","r":"y"}').toString("base64url")}`]) {
        const res = await handleMe(get("/api/me", c), deps);
        expect(res.status).toBe(401);
        expect(JSON.stringify(await res.json())).not.toMatch(/@|displayName/);
      }
    });
  });

  describe("AC-7 ログアウト", () => {
    it("ログアウト後、ログアウト前の cookie で保護 API を呼ぶと 401。cookie は消される", async () => {
      const deps = makeDeps(t);
      const reg = await handleRegister(post("/api/auth/register", { ...validRegistration, email: "out@example.test" }), deps);
      const cookie = cookieFrom(reg)!;
      expect((await handleMe(get("/api/me", cookie), deps)).status).toBe(200);

      const out = await handleLogout(post("/api/auth/logout", {}, cookie), deps);
      expect(out.status).toBe(200);
      expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);

      const after = await handleMe(get("/api/me", cookie), deps); // 古い cookie をそのまま使う
      expect(after.status).toBe(401);
      expect(JSON.stringify(await after.json())).not.toMatch(/out@example.test|たろう/);
      // 更新用のトークンでも戻れない
      const refresh = await handleRefresh(get("/api/auth/refresh", cookie), deps);
      expect(refresh.headers.get("location")).toMatch(/\/login$/);
    });

    it("cookie がなくてもログアウトはエラーにならない", async () => {
      const deps = makeDeps(t);
      const out = await handleLogout(post("/api/auth/logout", {}), deps);
      expect(out.status).toBe(200);
    });

    it("認証基盤でセッションを失効できなくても、cookie は消す（失敗の種類だけをログに出し、トークンは出さない）", async () => {
      const deps = makeDeps(t);
      const reg = await handleRegister(post("/api/auth/register", { ...validRegistration, email: "fail@example.test" }), deps);
      const cookie = cookieFrom(reg)!;
      deps.auth.unavailable = true;
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const out = await handleLogout(post("/api/auth/logout", {}, cookie), deps);
      const logged = JSON.stringify(spy.mock.calls);
      spy.mockRestore();
      expect(out.status).toBe(200);
      expect((await out.json()).revoked).toBe(false);
      expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
      expect(logged).not.toContain(decodeSession(cookie.split("=")[1])!.accessToken);
    });
  });

  describe("セッションの更新", () => {
    it("アクセストークンの期限が切れても、リフレッシュで続けられ、新しい cookie が返る", async () => {
      const deps = makeDeps(t);
      const reg = await handleRegister(post("/api/auth/register", { ...validRegistration, email: "renew@example.test" }), deps);
      const cookie = cookieFrom(reg)!;
      deps.auth.expireAccessToken(decodeSession(cookie.split("=")[1])!.accessToken);
      const me = await handleMe(get("/api/me", cookie), deps);
      expect(me.status).toBe(200);
      const renewed = cookieFrom(me);
      expect(renewed).toBeTruthy();
      expect(renewed).not.toBe(cookie);
      // 新しい cookie で続けて使える
      expect((await handleMe(get("/api/me", renewed), deps)).status).toBe(200);
    });

    it("/api/auth/refresh は、成功ならホームへ、失敗ならログインへ（cookie を消す）", async () => {
      const deps = makeDeps(t);
      const reg = await handleRegister(post("/api/auth/register", { ...validRegistration, email: "ref@example.test" }), deps);
      const ok = await handleRefresh(get("/api/auth/refresh", cookieFrom(reg)), deps);
      expect(ok.status).toBe(303);
      expect(ok.headers.get("location")).toMatch(/\/\?r=1$/);
      expect(cookieFrom(ok)).toBeTruthy();
      const ng = await handleRefresh(get("/api/auth/refresh", `${SESSION_COOKIE}=garbage`), deps);
      expect(ng.headers.get("location")).toMatch(/\/login$/);
      expect(ng.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    });

    it("認証基盤の不調のとき、未ログイン扱いにせず 503", async () => {
      const deps = makeDeps(t);
      const reg = await handleRegister(post("/api/auth/register", { ...validRegistration, email: "down@example.test" }), deps);
      const cookie = cookieFrom(reg)!;
      deps.auth.unavailable = true;
      expect((await handleMe(get("/api/me", cookie), deps)).status).toBe(503);
    });
  });

  describe("AC-8 cookie の属性・トークンの扱い", () => {
    const tokens = { accessToken: "AT", refreshToken: "RT" };
    const original = process.env.NODE_ENV;
    const setEnv = (v: string) => ((process.env as Record<string, string>).NODE_ENV = v);

    it("HttpOnly と SameSite=Lax が付く（開発用の設定）", () => {
      setEnv("development");
      try {
        const h = sessionCookieHeader(tokens);
        expect(h).toMatch(/; HttpOnly/);
        expect(h).toMatch(/; SameSite=Lax/);
        expect(h).not.toMatch(/Secure/);
      } finally {
        setEnv(original!);
      }
    });

    it("本番用の設定（NODE_ENV=production）では Secure も付く", () => {
      setEnv("production");
      try {
        const h = sessionCookieHeader(tokens);
        expect(h).toMatch(/; HttpOnly/);
        expect(h).toMatch(/; SameSite=Lax/);
        expect(h).toMatch(/; Secure/);
        expect(h).toMatch(/Max-Age=\d+/);
      } finally {
        setEnv(original!);
      }
    });

    it("ログイン・登録の応答の本文にトークンが含まれない（ブラウザのスクリプトからトークンを読めない）", async () => {
      const deps = makeDeps(t);
      const reg = await handleRegister(post("/api/auth/register", { ...validRegistration, email: "tok@example.test" }), deps);
      const login = await handleLogin(post("/api/auth/login", { email: "tok@example.test", password: validRegistration.password }), deps);
      for (const res of [reg, login]) {
        const body = JSON.stringify(await res.json());
        expect(body).not.toMatch(/fa_|fr_|access|refresh|token/i);
        expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/);
      }
    });

    it("resolveSession: 期限切れでリフレッシュも失敗なら none（allowRefresh=false なら更新しない）", async () => {
      const deps = makeDeps(t);
      const reg = await handleRegister(post("/api/auth/register", { ...validRegistration, email: "rs@example.test" }), deps);
      const v = cookieFrom(reg)!.split("=")[1];
      deps.auth.expireAccessToken(decodeSession(v)!.accessToken);
      expect((await resolveSession(deps.auth, v, false)).state).toBe("none");
      expect((await resolveSession(deps.auth, v, true)).state).toBe("ok");
    });
  });
});
