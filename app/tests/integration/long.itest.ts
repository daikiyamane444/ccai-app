// AC-12（A-1・本物）: アクセストークンの有効期間（既定1時間）を超えてからログアウトしても、旧 cookie 相当のトークンで更新・取得ができない。
// 約65分待つため、別の手動ジョブで1回だけ流す（.github/workflows/integration.yml の job: long）。
// 失敗時に値を出さないため、expect は直接使わない（lib.ts の ok / sameNumber）。
import { describe, it } from "vitest";
import { handleLogout, handleMe, handleRefresh } from "@/server/handlers";
import { supabaseAuth } from "@/server/auth/supabase";
import { createSignupPolicy } from "@/server/services/signup-policy";
import { encodeSession, SESSION_COOKIE } from "@/server/session";
import { useCiGuard } from "./env";
import { ok, sameNumber } from "./lib";

const WAIT_SECONDS = Number(process.env.CI_TOKEN_WAIT_SECONDS || 3900); // 65分

describe("AC-12 期限切れのアクセストークンでのログアウト（本物）", () => {
  const ctx = useCiGuard();

  it(`アクセストークンの期限（${WAIT_SECONDS}秒待つ）が切れたあとのログアウトで、旧 cookie は使えなくなる`, async () => {
    const u = await ctx.createUser("long");
    const t = await supabaseAuth.signIn(u.email, u.password);
    const cookie = `${SESSION_COOKIE}=${encodeSession(t.tokens)}`;
    const deps = { auth: supabaseAuth, db: ctx.db, signup: createSignupPolicy([]) };
    ok((await supabaseAuth.verify(t.tokens.accessToken))?.id === u.id, "待つ前は有効");

    await new Promise((r) => setTimeout(r, WAIT_SECONDS * 1000));

    // 前提: アクセストークンが期限切れになっている（なっていなければ、待ち時間が足りない）
    ok((await supabaseAuth.verify(t.tokens.accessToken)) === null, "待ったあと、アクセストークンが期限切れになっている（なっていなければ待ち時間不足）");

    const out = await handleLogout(new Request("http://localhost/api/auth/logout", { method: "POST", headers: { "content-type": "application/json", cookie }, body: "{}" }), deps);
    sameNumber(out.status, 200, "ログアウトの状態コード");
    ok((await out.json()).revoked === true, "失効できた");

    ok((await supabaseAuth.refresh(t.tokens.refreshToken)) === null, "旧リフレッシュトークンでの更新は拒否");
    const me = await handleMe(new Request("http://localhost/api/me", { headers: { cookie } }), deps);
    sameNumber(me.status, 401, "旧 cookie での /api/me");
    const refresh = await handleRefresh(new Request("http://localhost/api/auth/refresh", { headers: { cookie } }), deps);
    ok((refresh.headers.get("location") ?? "").endsWith("/login"), "旧 cookie での更新はログインへ");
  }, (WAIT_SECONDS + 600) * 1000);
});
