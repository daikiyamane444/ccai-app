// AC-12（A-1・本物）: アクセストークンの有効期間（既定1時間）を超えてからログアウトしても、旧 cookie 相当のトークンで更新・取得ができない。
// 約65分待つため、別の手動ジョブで1回だけ流す（.github/workflows/integration.yml の job: long）。
import { describe, expect, it } from "vitest";
import { handleLogout, handleMe, handleRefresh } from "@/server/handlers";
import { supabaseAuth } from "@/server/auth/supabase";
import { createSignupPolicy } from "@/server/services/signup-policy";
import { encodeSession, SESSION_COOKIE } from "@/server/session";
import { PASSWORD, useCiGuard } from "./env";

const WAIT_SECONDS = Number(process.env.CI_TOKEN_WAIT_SECONDS || 3900); // 65分

describe("AC-12 期限切れのアクセストークンでのログアウト（本物）", () => {
  const ctx = useCiGuard();

  it(`アクセストークンの期限（${WAIT_SECONDS}秒待つ）が切れたあとのログアウトで、旧 cookie は使えなくなる`, async () => {
    const u = await ctx.createUser("long");
    const t = await supabaseAuth.signIn(u.email, u.password);
    const cookie = `${SESSION_COOKIE}=${encodeSession(t.tokens)}`;
    const deps = { auth: supabaseAuth, db: ctx.db, signup: createSignupPolicy([]) };
    expect((await supabaseAuth.verify(t.tokens.accessToken))?.id === u.id).toBe(true);

    await new Promise((r) => setTimeout(r, WAIT_SECONDS * 1000));

    // 前提: アクセストークンが期限切れになっている（なっていなければ、待ち時間が足りない）
    expect(await supabaseAuth.verify(t.tokens.accessToken), "待ったあとも、アクセストークンがまだ有効（待ち時間不足）").toBeNull();

    const out = await handleLogout(new Request("http://localhost/api/auth/logout", { method: "POST", headers: { "content-type": "application/json", cookie }, body: "{}" }), deps);
    expect(out.status).toBe(200);
    expect((await out.json()).revoked, "失効できたか").toBe(true);

    expect(await supabaseAuth.refresh(t.tokens.refreshToken), "旧リフレッシュトークンでの更新").toBeNull();
    const me = await handleMe(new Request("http://localhost/api/me", { headers: { cookie } }), deps);
    expect(me.status).toBe(401);
    const refresh = await handleRefresh(new Request("http://localhost/api/auth/refresh", { headers: { cookie } }), deps);
    expect((refresh.headers.get("location") ?? "").endsWith("/login")).toBe(true);
    void PASSWORD;
  }, (WAIT_SECONDS + 600) * 1000);
});
