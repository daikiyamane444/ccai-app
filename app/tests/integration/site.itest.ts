// 公開URL（Vercel）に対する結合テスト（SPEC-000c AC-14、AC-16、AC-17、AC-18、AC-7 の一部）。GitHub Actions から手動で起動する。
import { describe, expect, it } from "vitest";
import { asService, listAllUsers, PASSWORD, requireEnv, useCiGuard } from "./env";
import { FORBIDDEN_NAMES, functionRegionFromVercelId, isCiEmail, leakLabels } from "./lib";

function site(): string {
  return requireEnv("CI_SITE_URL").CI_SITE_URL.replace(/\/+$/, "");
}

describe("公開URL（結合テスト）", () => {
  const ctx = useCiGuard();

  it("AC-14 関数の実行地域が東京（hnd1）", async () => {
    const res = await fetch(`${site()}/api/me`, { headers: { "cache-control": "no-cache" } });
    const region = functionRegionFromVercelId(res.headers.get("x-vercel-id"));
    expect(res.status).toBe(401);
    expect(region, "x-vercel-id から読み取った関数の実行地域").toBe("hnd1");
  }, 60_000);

  it("AC-7 noindex と robots.txt", async () => {
    const res = await fetch(`${site()}/login`);
    expect(/noindex/.test(res.headers.get("x-robots-tag") ?? "")).toBe(true);
    const robots = await fetch(`${site()}/robots.txt`);
    expect(robots.status === 200 && /Disallow:\s*\/\s*$/m.test(await robots.text())).toBe(true);
  }, 60_000);

  it("AC-16 ログインの応答の cookie に Secure・HttpOnly・SameSite=Lax。HTTP は HTTPS に移る。ログアウトで旧 cookie は使えなくなる", async () => {
    const u = await ctx.createUser("site-login");
    const login = await fetch(`${site()}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: u.email, password: PASSWORD }),
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get("set-cookie") ?? "";
    expect(/^ccai_session=[^;]+/.test(setCookie)).toBe(true);
    expect(/;\s*HttpOnly/i.test(setCookie)).toBe(true);
    expect(/;\s*Secure/i.test(setCookie)).toBe(true);
    expect(/;\s*SameSite=Lax/i.test(setCookie)).toBe(true);
    const bodyText = await login.text();
    expect(/access_token|refresh_token|eyJ[A-Za-z0-9_-]{20,}/.test(bodyText), "応答の本文にトークンらしき文字列").toBe(false);

    const cookie = setCookie.split(";")[0];
    const me = await fetch(`${site()}/api/me`, { headers: { cookie } });
    expect(me.status).toBe(200);

    const http = await fetch(site().replace(/^https:/, "http:") + "/", { redirect: "manual" });
    expect([301, 302, 307, 308].includes(http.status) && (http.headers.get("location") ?? "").startsWith("https://")).toBe(true);

    const out = await fetch(`${site()}/api/auth/logout`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: "{}" });
    expect(out.status).toBe(200);
    expect((await out.json()).revoked).toBe(true);
    const after = await fetch(`${site()}/api/me`, { headers: { cookie } });
    expect(after.status).toBe(401);
  }, 90_000);

  it("AC-17 配信されるページ・スクリプト・RSC に、キー・接続情報・環境変数名・登録許可の一覧の中身が含まれない", async () => {
    const base = site();
    const texts: string[] = [];
    const seen = new Set<string>();
    const fetchText = async (path: string, rsc = false) => {
      const url = path.startsWith("http") ? path : base + path;
      if (seen.has(url + rsc)) return "";
      seen.add(url + rsc);
      const res = await fetch(url, { headers: rsc ? { RSC: "1" } : {}, redirect: "follow" });
      const t = await res.text();
      texts.push(t);
      return t;
    };
    const scripts = new Set<string>();
    for (const p of ["/login", "/register", "/", "/api/me", "/manifest.webmanifest", "/sw.js", "/robots.txt"]) {
      const html = await fetchText(p);
      for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.(?:js|css))"/g)) scripts.add(m[1]);
      for (const m of html.matchAll(/"(\/_next\/static\/[^"]+\.js)"/g)) scripts.add(m[1]);
      if (["/login", "/register", "/"].includes(p)) await fetchText(p, true); // RSC ペイロード
    }
    for (const s of scripts) await fetchText(s);
    expect(scripts.size, "検査したスクリプトの数").toBeGreaterThan(0);

    const env = process.env;
    const hits = leakLabels(texts, {
      SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
      DB_PASSWORD: env.DB_PASSWORD,
      DB_HOST: env.DB_HOST,
      CI_LEAK_PROBE: env.CI_LEAK_PROBE,
      ...Object.fromEntries(FORBIDDEN_NAMES.map((n) => [`名前:${n}`, n])),
    });
    expect(hits, `配信物に含まれていたもの（${texts.length}件を検査）`).toEqual([]);
  }, 180_000);

  it("AC-18 一覧にないアドレスで新規登録すると固定文で拒否され、ユーザーが増えない", async () => {
    const email = ctx.email("site-register");
    const before = (await listAllUsers(ctx.admin)).length;
    const res = await fetch(`${site()}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, displayName: "ci", ageConfirmed: true }),
    });
    const json = (await res.json()) as { error?: string };
    expect(res.status).toBe(403);
    expect(json.error).toBe("現在、新規登録を受け付けていません");
    expect(res.headers.get("set-cookie")).toBeNull();
    const users = await listAllUsers(ctx.admin);
    expect(users.length, "ユーザー数（登録の前後で同じ）").toBe(before);
    expect(users.some((u) => u.email === email)).toBe(false);
    const profiles = await asService(ctx.db, async (c) => (await c.query("select count(*)::int as n from public.profiles p where p.user_id = any($1::uuid[])", [users.filter((u) => isCiEmail(u.email)).map((u) => u.id)])).rows[0].n as number);
    expect(profiles, "テスト用ユーザーのプロフィール数（登録の拒否では増えない）").toBe(0);
  }, 90_000);
});
