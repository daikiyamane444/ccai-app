// ビルド確認: (1) next build が通る（型検査込み）(2) ブラウザに渡る成果物に秘密・環境変数名が混ざらない
// (3) 接続先なしで起動し、主要な画面・APIが期待どおり応答する（AC-2, AC-6, AC-8, AC-14, AC-17 の一部）
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = ".next-check";
const distDir = join(appDir, dist);
const PORT = 3917;
const DUMMY = {
  SUPABASE_URL: "https://dummy-project-ref.supabase.invalid",
  SUPABASE_ANON_KEY: "dummy-anon-key-zzz111",
  SUPABASE_SERVICE_ROLE_KEY: "dummy-service-role-zzz222",
  DATABASE_URL: "postgres://dummyuser:dummypass-zzz333@127.0.0.1:1/dummydb",
  DB_HOST: "dummy-db-host-zzz444.invalid",
  DB_PASSWORD: "dummy-db-password-zzz555",
  SIGNUP_ALLOWED_EMAILS: "dummy-owner-zzz666@example.invalid",
};
let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) passed++;
  else failures.push(`${name} ${detail}`);
  console.log(`${ok ? "  ok  " : "  NG  "}${name}${ok ? "" : " " + detail}`);
};

function walk(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) out.push(...walk(f));
    else out.push(f);
  }
  return out;
}

// --- 1. ビルド（ダミーの値を入れる。ブラウザ向け成果物に出てきたら漏れ）
console.log("[check-build] next build ...");
rmSync(distDir, { recursive: true, force: true });
const build = spawnSync("npx", ["next", "build"], {
  cwd: appDir,
  env: { ...process.env, ...DUMMY, NEXT_DIST_DIR: dist, NEXT_TELEMETRY_DISABLED: "1" },
  encoding: "utf8",
});
check("next build が成功する（型検査を含む）", build.status === 0, `\n${build.stdout}\n${build.stderr}`);
if (build.status !== 0) finish();

// --- 2. ブラウザ向け成果物の検査
const publicFiles = existsSync(join(appDir, "public")) ? walk(join(appDir, "public")).filter((f) => !/\.png$/.test(f)) : [];
const browserFiles = [
  ...walk(join(distDir, "static")),
  // HTML と、ブラウザに配信される RSC ペイロード（.rsc。SPEC-000c A-5）
  ...walk(join(distDir, "server")).filter((f) => f.endsWith(".html") || f.endsWith(".rsc")),
  ...publicFiles,
];
const needles = [
  ...Object.values(DUMMY),
  ...Object.keys(DUMMY),
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_URL",
  "DATABASE_URL",
  "SIGNUP_ALLOWED_EMAILS",
  "DB_PASSWORD",
  "service_role",
  "dummypass",
];
const hits = [];
for (const f of browserFiles) {
  const text = readFileSync(f, "utf8");
  for (const n of needles) if (text.includes(n)) hits.push(`${f.replace(appDir + "/", "")} に ${n}`);
}
const rscCount = browserFiles.filter((f) => f.endsWith(".rsc")).length;
check(`検査の対象に RSC ペイロード（.rsc）が含まれる（${rscCount}ファイル）`, rscCount > 0);
check(`ブラウザ向け成果物（${browserFiles.length}ファイル）に接続先・キー・環境変数名が含まれない`, hits.length === 0, hits.join(", "));
const clientJs = walk(join(distDir, "static")).filter((f) => f.endsWith(".js"));
check("ブラウザ向けJSに認証SDK（supabase）が含まれない", !clientJs.some((f) => /supabase/i.test(readFileSync(f, "utf8"))));

// --- 3. 接続先なしで起動して疎通
console.log("[check-build] next start（接続先の環境変数なし）...");
const env = { ...process.env, NEXT_DIST_DIR: dist, PORT: String(PORT), NEXT_TELEMETRY_DISABLED: "1" };
for (const k of Object.keys(DUMMY)) delete env[k];
const server = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: appDir, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
const base = `http://127.0.0.1:${PORT}`;
const stop = () => {
  try { process.kill(-server.pid, "SIGTERM"); } catch {}
};

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${base}/login`, { redirect: "manual" });
      if (r.status > 0) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

try {
  const ready = await waitReady();
  check("接続先なしでサーバーが起動する", ready, serverLog);
  if (ready) {
    const json = { "content-type": "application/json" };
    let r = await fetch(`${base}/login`);
    const html = await r.text();
    check("AC-2 /login が接続先なしで200・ログイン画面が出る", r.status === 200 && html.includes("ログイン"), `status=${r.status}`);
    check("/login に no-store", /no-store/.test(r.headers.get("cache-control") ?? ""));
    check("セキュリティヘッダ（nosniff・DENY）", r.headers.get("x-content-type-options") === "nosniff" && r.headers.get("x-frame-options") === "DENY");
    check("AC-7 全ページに noindex（X-Robots-Tag）", /noindex/.test(r.headers.get("x-robots-tag") ?? "") && /name="robots" content="noindex/.test(html));
    check("X-Powered-By を出さない", !r.headers.get("x-powered-by"));

    r = await fetch(`${base}/register`);
    const reg = await r.text();
    check("/register が200で、18歳以上の確認がある", r.status === 200 && reg.includes("18"), `status=${r.status}`);

    r = await fetch(`${base}/`, { redirect: "manual" });
    check("AC-6 未ログインの / は /login へ", [302, 303, 307, 308].includes(r.status) && (r.headers.get("location") ?? "").endsWith("/login"), `status=${r.status} loc=${r.headers.get("location")}`);

    r = await fetch(`${base}/api/me`);
    const meBody = await r.text();
    check("AC-7 未ログインの /api/me は401で、情報を返さない", r.status === 401 && !/email|display/i.test(meBody), `status=${r.status}`);

    r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ email: "a@example.com", password: "password123" }) });
    const lb = await r.text();
    check("接続先なしのログインは503で、案内の文言（秘密を含まない）", r.status === 503 && !/dummy|supabase_/i.test(lb), `status=${r.status} body=${lb}`);

    r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    check("JSON以外のPOSTは拒否される（CSRF対策）", r.status === 415 || r.status === 400, `status=${r.status}`);

    r = await fetch(`${base}/robots.txt`);
    const robots = await r.text();
    check("AC-7 robots.txt が全体のクロールを拒否する", r.status === 200 && /Disallow:\s*\/\s*$/m.test(robots) && /noindex/.test(r.headers.get("x-robots-tag") ?? ""), `status=${r.status}`);

    r = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: "stranger@example.com", password: "password123", displayName: "x", ageConfirmed: true }),
    });
    const rb = await r.text();
    check("AC-5 許可の一覧が未設定なら、登録は403で固定文（認証基盤に送らない。接続先なしでも503にならない）", r.status === 403 && rb.includes("新規登録を受け付けていません"), `status=${r.status} body=${rb}`);

    r = await fetch(`${base}/manifest.webmanifest`);
    check("AC-16 マニフェストが配信される", r.status === 200 && (await r.json()).name === "CCAI（仮称）");
    r = await fetch(`${base}/icons/icon-192.png`);
    check("アイコンが配信される", r.status === 200 && (r.headers.get("content-type") ?? "").includes("image/png"), `status=${r.status}`);
    r = await fetch(`${base}/sw.js`);
    check("AC-17 sw.js が配信される", r.status === 200 && !/caches\.open/.test(await r.text()));

    r = await fetch(`${base}/no-such-page`);
    check("存在しないページは404（日本語の案内）", r.status === 404 && (await r.text()).includes("見つかりません"), `status=${r.status}`);
  }
} finally {
  stop();
  rmSync(distDir, { recursive: true, force: true });
}
finish();

function finish() {
  console.log(`\n[check-build] ${passed} 件成功 / ${failures.length} 件失敗`);
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  process.exit(0);
}
