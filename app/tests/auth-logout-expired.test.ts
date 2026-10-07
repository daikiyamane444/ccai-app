// SPEC-000c AC-1（A-1）: 期限切れのアクセストークンでログアウトしても、旧 cookie でセッションの更新も保護APIの利用もできない
// AC-2（A-2）: 2人分の分離（API経由）
// 偽の認証基盤は、本物と同じく「期限切れのアクセストークンでは失効できない」ようにしてある（fake.ts）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleLogin, handleLogout, handleMe, handleRefresh, handleRegister } from "@/server/handlers";
import { decodeSession, resolveSession } from "@/server/session";
import { AuthError } from "@/server/auth";
import { createPairForTest } from "@/server/privileged";
import { cookieFrom, get, makeDeps, post, validRegistration } from "./helpers/app";
import { createTestDb, type TestDb } from "./helpers/db";

describe("SPEC-000c A-1 期限切れトークンでのログアウト", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("（前提）偽の認証基盤は、期限切れのアクセストークンでの失効要求を拒否する（本物と同じ）", async () => {
    const deps = makeDeps(t);
    const reg = await handleRegister(post("/api/auth/register", { ...validRegistration, email: "pre@example.test" }), deps);
    const tokens = decodeSession(cookieFrom(reg)!.split("=")[1])!;
    deps.auth.expireAccessToken(tokens.accessToken);
    await expect(deps.auth.signOut(tokens.accessToken)).rejects.toMatchObject({ code: "invalid_token" });
    await expect(deps.auth.signOut(tokens.accessToken)).rejects.toBeInstanceOf(AuthError);
  });

  it("アクセストークンが期限切れの状態でログアウトしても、旧 cookie では /api/me も更新もできない", async () => {
    const deps = makeDeps(t);
    const reg = await handleRegister(post("/api/auth/register", { ...validRegistration, email: "expired@example.test" }), deps);
    const cookie = cookieFrom(reg)!;
    const tokens = decodeSession(cookie.split("=")[1])!;

    deps.auth.expireAccessToken(tokens.accessToken); // ホームを開いたまま1時間以上たった状態

    const out = await handleLogout(post("/api/auth/logout", {}, cookie), deps);
    expect(out.status).toBe(200);
    expect((await out.json()).revoked).toBe(true);
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);

    // 旧 cookie（リフレッシュトークンを含む）で戻れない
    const me = await handleMe(get("/api/me", cookie), deps);
    expect(me.status).toBe(401);
    expect(await deps.auth.refresh(tokens.refreshToken)).toBeNull();
    const refresh = await handleRefresh(get("/api/auth/refresh", cookie), deps);
    expect(refresh.headers.get("location")).toMatch(/\/login$/);
    expect((await resolveSession(deps.auth, cookie.split("=")[1])).state).toBe("none");
  });

  it("全端末からのログアウト: 別の端末（別のセッション）も使えなくなる（A-8）", async () => {
    const deps = makeDeps(t);
    const reg = await handleRegister(post("/api/auth/register", { ...validRegistration, email: "global@example.test" }), deps);
    const pc = cookieFrom(reg)!;
    const phoneRes = await handleLogin(post("/api/auth/login", { email: "global@example.test", password: validRegistration.password }), deps);
    const phone = cookieFrom(phoneRes)!;
    expect((await handleMe(get("/api/me", phone), deps)).status).toBe(200);

    await handleLogout(post("/api/auth/logout", {}, pc), deps); // PC でログアウト

    expect((await handleMe(get("/api/me", phone), deps)).status).toBe(401); // iPhone も入れない
    expect((await handleMe(get("/api/me", pc), deps)).status).toBe(401);
  });

  it("失効済みの cookie でのログアウトも、エラーにならず cookie を消す", async () => {
    const deps = makeDeps(t);
    const reg = await handleRegister(post("/api/auth/register", { ...validRegistration, email: "twice@example.test" }), deps);
    const cookie = cookieFrom(reg)!;
    await handleLogout(post("/api/auth/logout", {}, cookie), deps);
    const again = await handleLogout(post("/api/auth/logout", {}, cookie), deps);
    expect(again.status).toBe(200);
    expect(again.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });

  it("認証基盤が不調で更新もできないときは revoked=false だが、cookie は消す", async () => {
    const deps = makeDeps(t);
    const reg = await handleRegister(post("/api/auth/register", { ...validRegistration, email: "down@example.test" }), deps);
    const cookie = cookieFrom(reg)!;
    const tokens = decodeSession(cookie.split("=")[1])!;
    deps.auth.expireAccessToken(tokens.accessToken);
    deps.auth.unavailable = true;
    const out = await handleLogout(post("/api/auth/logout", {}, cookie), deps);
    expect((await out.json()).revoked).toBe(false);
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });
});

describe("SPEC-000c AC-2 API経由の2人分の分離", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("AとBがそれぞれログインした状態で、Bのセッションの /api/me に A の情報が出ない。同じ pair にしても同じ", async () => {
    const deps = makeDeps(t);
    const regA = await handleRegister(post("/api/auth/register", { ...validRegistration, email: "alice@example.test", displayName: "アリス" }), deps);
    const regB = await handleRegister(post("/api/auth/register", { ...validRegistration, email: "bob@example.test", displayName: "ボブ" }), deps);
    const cookieA = cookieFrom(regA)!;
    const cookieB = cookieFrom(regB)!;

    const check = async () => {
      const a = await (await handleMe(get("/api/me", cookieA), deps)).json();
      const b = await (await handleMe(get("/api/me", cookieB), deps)).json();
      expect(a.user.email).toBe("alice@example.test");
      expect(a.profile.displayName).toBe("アリス");
      expect(b.user.email).toBe("bob@example.test");
      expect(b.profile.displayName).toBe("ボブ");
      const bText = JSON.stringify(b);
      expect(bText).not.toMatch(/alice|アリス/);
      expect(JSON.stringify(a)).not.toMatch(/bob|ボブ/);
    };
    await check();

    // 同じ active の pair に登録しても、相手の情報は見えない
    const idA = (await (await handleMe(get("/api/me", cookieA), deps)).json()).user.id as string;
    const idB = (await (await handleMe(get("/api/me", cookieB), deps)).json()).user.id as string;
    await createPairForTest(t.db, [idA, idB]);
    await check();
  });
});
