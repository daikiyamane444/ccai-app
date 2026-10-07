// 静的な確認（ファイル・依存・ソースの検査）。AC-3, AC-8, AC-14, AC-15, AC-16, AC-17, AC-18 の一部
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(appDir, p), "utf8");

function walk(dir: string, filter: (f: string) => boolean = () => true): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", ".next-check"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}
const srcFiles = walk(join(appDir, "src"), (f) => /\.(ts|tsx)$/.test(f));
const rel = (f: string) => relative(appDir, f);

describe("AC-3 .env.example と .gitignore", () => {
  const example = read(".env.example");
  const lines = example.split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l));
  const names = lines.map((l) => l.split("=")[0]);

  it("コードが読む環境変数がすべて .env.example に並んでいる", () => {
    const used = new Set<string>();
    const integration = walk(join(appDir, "tests/integration"), (f) => /\.ts$/.test(f));
    for (const f of [...srcFiles, ...integration, join(appDir, "next.config.ts"), join(appDir, "tests/global-setup.ts")]) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]);
      for (const m of text.matchAll(/(?:getEnv|read)\(\s*["']([A-Z][A-Z0-9_]+)["']\s*\)/g)) used.add(m[1]);
    }
    for (const skip of ["NODE_ENV", "NEXT_RUNTIME"]) used.delete(skip);
    expect([...used].filter((n) => !names.includes(n))).toEqual([]);
  });

  it("各変数に説明（直前のコメント行）がある", () => {
    const all = example.split("\n");
    for (const n of names) {
      const i = all.findIndex((l) => l.startsWith(`${n}=`));
      let j = i - 1;
      while (j >= 0 && all[j].trim() === "") j--;
      expect(all[j]?.startsWith("#"), `${n} に説明がない`).toBe(true);
    }
  });

  it("値は空か、短い安全な既定値だけ（実際のキー・パスワードを含まない）", () => {
    for (const l of lines) {
      const value = l.slice(l.indexOf("=") + 1).trim();
      expect(value === "" || /^[0-9a-z._-]{1,12}$/.test(value), `${l}`).toBe(true);
    }
  });

  it("ソース・設定・ドキュメントにキーらしき文字列がない", () => {
    const files = [
      ...walk(join(appDir, "src")),
      // check-build.mjs は「漏れ検出用のダミー値」を持つので除く（本物ではない）
      ...walk(join(appDir, "scripts"), (f) => !f.endsWith("check-build.mjs")),
      ...walk(join(appDir, "supabase")),
      ...walk(join(appDir, "public"), (f) => !/\.png$/.test(f)),
      join(appDir, ".env.example"),
      join(appDir, "README.md"),
    ].filter((f) => existsSync(f));
    const patterns = [/eyJ[A-Za-z0-9_-]{20,}/, /sk-[A-Za-z0-9]{20,}/, /sb_secret_[A-Za-z0-9]+/, /postgres(?:ql)?:\/\/[^:\s/$]+:[^@\s]+@/];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const p of patterns) expect(text, `${rel(f)} が ${p} に一致`).not.toMatch(p);
    }
  });

  it(".env は git 管理外（.gitignore）", () => {
    const ig = read(".gitignore").split("\n");
    expect(ig).toContain(".env");
    expect(ig.some((l) => l === ".env.local" || l === ".env.*.local")).toBe(true);
  });
});

describe("AC-8 / AC-14 ブラウザ向けコードと特権の分離", () => {
  const clientFiles = srcFiles.filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8").slice(0, 200)));

  it("ブラウザ向けのコード（use client）は、サーバー側のコード・認証SDK・DBを読み込まない", () => {
    expect(clientFiles.length).toBeGreaterThan(0);
    for (const f of clientFiles) {
      const text = readFileSync(f, "utf8");
      expect(text, rel(f)).not.toMatch(/from\s+["'](@\/server|\.\.?\/.*server|@supabase\/|pg["'])/);
      expect(text, rel(f)).not.toMatch(/SUPABASE|DATABASE_URL|process\.env\.(?!NODE_ENV)/);
    }
  });

  it("認証SDK（@supabase/supabase-js）の読み込みは、認証アダプタと privileged だけ", () => {
    const allowed = ["src/server/auth/supabase.ts", "src/server/privileged/index.ts"];
    const users = srcFiles.filter((f) => /@supabase\/supabase-js/.test(readFileSync(f, "utf8"))).map(rel);
    expect(users.sort()).toEqual(allowed.sort());
  });

  it("特権（service_role・管理用キー・runPrivileged・auth.admin）は src/server/privileged/ の外に書かれていない", () => {
    const needles = [/service_role/i, /SUPABASE_SERVICE_ROLE_KEY/, /runPrivileged/, /auth\.admin/];
    for (const f of srcFiles) {
      if (rel(f).startsWith("src/server/privileged/")) continue;
      const text = readFileSync(f, "utf8");
      for (const n of needles) expect(text, `${rel(f)} に ${n}`).not.toMatch(n);
    }
  });

  it("privileged を読み込むのは、決められた2か所だけ（アカウント削除の処理と、認証アダプタ）", () => {
    const allowed = ["src/server/auth/supabase.ts", "src/server/services/account.ts"];
    const users = srcFiles
      .filter((f) => !rel(f).startsWith("src/server/privileged/"))
      .filter((f) => /from\s+["'](\.\.?\/)+privileged["']|@\/server\/privileged/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(users.sort()).toEqual(allowed.sort());
  });

  it("DB の接続（pool）をアプリのデータ層が直接使うのは db/ と privileged/ の中だけ（データ読み書きは asUser / asAnon を通る）", () => {
    for (const f of srcFiles) {
      const r = rel(f);
      if (r.startsWith("src/server/db/") || r.startsWith("src/server/privileged/")) continue;
      expect(readFileSync(f, "utf8"), r).not.toMatch(/\.pool\.(query|connect)/);
    }
  });
});

describe("AC-15 スマホ幅の見た目（CSS の静的確認。実際の見た目は画面確認）", () => {
  const css = read("src/app/globals.css");
  const block = (selector: string): string => {
    const m = css.match(new RegExp(`${selector.replace(/[.[\]]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
    expect(m, `${selector} の定義がない`).toBeTruthy();
    return m![1];
  };
  const px = (b: string, prop: string) => Number(b.match(new RegExp(`${prop}:\\s*(\\d+)px`))?.[1] ?? 0);

  it("入力欄の文字は16px以上、高さ44px以上", () => {
    const b = block('input[type="email"], input[type="password"], input[type="text"]');
    expect(px(b, "font-size")).toBeGreaterThanOrEqual(16);
    expect(px(b, "min-height")).toBeGreaterThanOrEqual(44);
  });
  it("ボタン・文字リンク型ボタンの最小の高さ・幅が44px以上", () => {
    const b = block(".btn");
    expect(px(b, "min-height")).toBeGreaterThanOrEqual(44);
    expect(px(b, "min-width")).toBeGreaterThanOrEqual(44);
    expect(px(b, "font-size")).toBeGreaterThanOrEqual(16);
  });
  it("チェックボックスの行も44px以上", () => {
    expect(px(block(".check"), "min-height")).toBeGreaterThanOrEqual(44);
  });
  it("ページの幅は 430px 以内で、横スクロールを起こす固定幅がない", () => {
    expect(px(block(".page"), "max-width")).toBeLessThanOrEqual(430);
    expect(css).not.toMatch(/(?<![-\w])width:\s*\d{3,}px/);
  });
  it("viewport が device-width", () => {
    expect(read("src/app/layout.tsx")).toMatch(/width:\s*"device-width"/);
  });
});

describe("AC-16 Webアプリのマニフェスト", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  it("名前・起動URL・表示モード・アイコン", () => {
    expect(manifest.name).toBe("CCAI（仮称）");
    expect(manifest.start_url).toBe("/");
    expect(["standalone", "fullscreen", "minimal-ui"]).toContain(manifest.display);
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  });
  it("アイコンのファイルが存在し、宣言どおりのサイズのPNG", () => {
    for (const i of manifest.icons as { src: string; sizes: string }[]) {
      const buf = readFileSync(join(appDir, "public", i.src));
      expect(buf.subarray(1, 4).toString()).toBe("PNG");
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      expect(`${w}x${h}`).toBe(i.sizes);
    }
    const apple = readFileSync(join(appDir, "public/icons/apple-touch-icon.png"));
    expect(apple.readUInt32BE(16)).toBe(180);
  });
  it("ページがマニフェストと iOS 用アイコンを参照している", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toMatch(/manifest:\s*"\/manifest\.webmanifest"/);
    expect(layout).toMatch(/apple:\s*"\/icons\/apple-touch-icon\.png"/);
    expect(layout).toMatch(/appleWebApp/);
  });
});

describe("AC-17 Service Worker", () => {
  const sw = read("public/sw.js").replace(/\/\/.*$/gm, "");
  it("何もキャッシュしない（保存の API を使わず、fetch を横取りしない）", () => {
    expect(sw).not.toMatch(/caches\.open|\.put\(|\.add\(|\.addAll\(|addEventListener\(\s*["']fetch["']/);
  });
  it("過去のキャッシュを消す", () => {
    expect(sw).toMatch(/caches\.delete|caches\.keys/);
  });
});

describe("AC-18 範囲（依存関係とルート）", () => {
  const pkg = JSON.parse(read("package.json"));
  it("依存は承認済みの構成だけ（Next.js、React、DB、Supabase SDK）", () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["@supabase/supabase-js", "next", "pg", "react", "react-dom"]);
  });
  it("開発用の依存に、LLM・メール送信・監視・解析のものがない", () => {
    const all = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(all.filter((n) => /sentry|datadog|posthog|analytics|mixpanel|resend|nodemailer|sendgrid|mailgun|openai|anthropic|claude|gemini|web-push|firebase/i.test(n))).toEqual([]);
  });
  it("画面・APIのルートは 000a の範囲だけ（登録・ログイン・ホーム・ログアウト・更新・自分の情報）", () => {
    const routes = walk(join(appDir, "src/app"), (f) => /(page|route)\.tsx?$/.test(f))
      .map((f) => relative(join(appDir, "src/app"), f))
      .sort();
    expect(routes).toEqual([
      "api/auth/login/route.ts",
      "api/auth/logout/route.ts",
      "api/auth/refresh/route.ts",
      "api/auth/register/route.ts",
      "api/me/route.ts",
      "login/page.tsx",
      "page.tsx",
      "register/page.tsx",
    ]);
  });
});

describe("SPEC-000c 公開と結合テストの定義", () => {
  const repoRoot = resolve(appDir, "..");
  const workflow = readFileSync(join(repoRoot, ".github/workflows/integration.yml"), "utf8");

  it("AC-15 ブラウザに渡る種類の環境変数（NEXT_PUBLIC_）を使っていない。.env.example にも作っていない", () => {
    for (const f of [...srcFiles, join(appDir, "next.config.ts"), join(appDir, ".env.example"), join(appDir, "vercel.json")]) {
      const text = readFileSync(f, "utf8").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
      expect(text, rel(f)).not.toMatch(/NEXT_PUBLIC_[A-Z]/);
    }
  });

  it("AC-14 Vercel の関数の実行地域が東京（hnd1）で、Hobby で許される1地域だけ", () => {
    const v = JSON.parse(read("vercel.json"));
    expect(v.regions).toEqual(["hnd1"]);
  });

  it("結合テストの起動は手動（workflow_dispatch）だけ。push・pull_request・schedule では動かない", () => {
    const on = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\npermissions:"));
    expect(on).toMatch(/workflow_dispatch/);
    expect(on).not.toMatch(/\b(push|pull_request|pull_request_target|schedule|workflow_run|issues|issue_comment)\b\s*:/);
    expect(workflow).toMatch(/permissions:\s*\n\s+contents:\s*read/);
  });

  it("ワークフローは秘密情報を secrets から環境変数に渡すだけで、値を出力しない・Postgres 管理者のパスワードを使わない", () => {
    const code = workflow.replace(/^\s*#.*$/gm, "");
    expect(code).not.toMatch(/\becho\b|::add-mask|\bprintenv\b|\benv\s*$|\bset\s+-x\b|--debug|ACTIONS_STEP_DEBUG|RUNNER_DEBUG/m);
    expect(code).not.toMatch(/\$\{\{\s*secrets\.(?!SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|DB_HOST|DB_PASSWORD|CI_SITE_URL|CI_LEAK_PROBE)[A-Z_]+/);
    expect(code).not.toMatch(/postgres:|DATABASE_URL|POSTGRES_PASSWORD|SUPABASE_DB_PASSWORD/i);
    // secrets の参照は env の値としてだけ使う（run の中に直接書かない）
    for (const m of code.matchAll(/^\s*-?\s*run:.*$/gm)) expect(m[0]).not.toMatch(/secrets\./);
  });

  it("結合テストのコードが、秘密・トークン・本人のメールアドレスを出力しない（console 出力なし。expect に値そのものを渡さない）", () => {
    for (const f of walk(join(appDir, "tests/integration"), (x) => /\.ts$/.test(x))) {
      const text = readFileSync(f, "utf8");
      expect(text, rel(f)).not.toMatch(/console\.(log|error|warn|info|debug)/);
    }
  });

  it("結合テストは、決まった形以外のユーザーを削除しない（削除の対象は isCiEmail を通ったものだけ）", () => {
    const env = read("tests/integration/env.ts");
    expect(env).toMatch(/filter\(\(u\) => isCiEmail\(u\.email\)\)/);
    // deleteUser / deleteAccount を呼ぶ箇所は、後片付け（deleteCiUsers）の中だけ
    const calls = [...env.matchAll(/admin\.deleteUser|auth\.admin\.deleteUser|deleteAccount\(/g)].length;
    expect(calls).toBeGreaterThan(0);
    const sites = read("tests/integration/site.itest.ts") + read("tests/integration/long.itest.ts");
    expect(sites).not.toMatch(/deleteUser|deleteAccount/);
  });

  it("マイグレーションの適用や設定の変更をしない（結合テストにDDLがない）", () => {
    for (const f of walk(join(appDir, "tests/integration"), (x) => /\.ts$/.test(x))) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/\b(create|alter|drop)\s+(table|role|policy|schema|function|extension)\b|\bgrant\s+\w|\brevoke\s+\w/i);
    }
  });

  it("AC-4 ビルド検査が .rsc を対象にしている", () => {
    expect(read("scripts/check-build.mjs")).toMatch(/\.rsc/);
  });
});

describe("SPEC-000c AC-7 ログアウトの失効範囲（全端末）の記述が一致している（A-8）", () => {
  it("型の説明・特権部品・偽の認証基盤・ハンドラ・README が、いずれも全端末（global）と書いている", () => {
    expect(read("src/server/auth/types.ts")).toMatch(/全端末/);
    expect(read("src/server/privileged/index.ts")).toMatch(/global/);
    expect(read("src/server/privileged/index.ts")).toMatch(/全端末/);
    expect(read("src/server/auth/fake.ts")).toMatch(/全セッション/);
    expect(read("src/server/handlers/index.ts")).toMatch(/全端末/);
    expect(read("README.md")).toMatch(/ログアウトは全端末/);
    // 「そのセッションだけ」を失効させるという古い記述が残っていない
    for (const f of srcFiles) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/そのセッションを失効|scope:\s*["']local["']|"local"/);
  });
});

describe("SPEC-000c QA CI-1・CI-2", () => {
  const repoRoot = resolve(appDir, "..");
  const workflow = readFileSync(join(repoRoot, ".github/workflows/integration.yml"), "utf8");

  it("CI-1 秘密情報はジョブ全体の env に置かない（ステップの env だけ）", () => {
    for (const m of workflow.matchAll(/^ {4}env:\s*$/gm)) expect(m[0], "ジョブ直下の env").toBe("");
    // npm ci・npm test のステップには env を付けない
    expect(workflow).toMatch(/- run: npm ci\n(?:\s*#.*\n)*\s+- run: npm test\n(?:\s*#.*\n)*\s+- run: /);
  });

  it("CI-2 後片付けのステップが if: always() で動き、管理用キーとURLだけを受け取る", () => {
    const blocks = [...workflow.matchAll(/- run: npm run ci:cleanup\n\s+if: \$\{\{ always\(\) \}\}\n\s+env:\n((?:\s+\w+: .*\n?)+)/g)];
    expect(blocks.length).toBe(2);
    for (const b of blocks) expect([...b[1].matchAll(/^\s+(\w+):/gm)].map((x) => x[1]).sort()).toEqual(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"]);
  });

  it("CI-2 後片付けスクリプトの判定の正規表現が、結合テストの CI_EMAIL_RE と同じ", () => {
    const lib = read("tests/integration/lib.ts").match(/CI_EMAIL_RE = (\/.*\/);/)![1];
    const script = read("scripts/ci-cleanup.mjs").match(/const CI_EMAIL_RE = (\/.*\/);/)![1];
    expect(script).toBe(lib);
    expect(read("scripts/ci-cleanup.mjs")).not.toMatch(/\$\{(u\.email|key|url)\}/);
  });

  it("CI-2 テスト用ユーザーのパスワードは実行ごとにランダムで、コードに固定値がない", () => {
    const env = read("tests/integration/env.ts");
    expect(env).toMatch(/PASSWORD = `Ci-\$\{randomBytes\(/);
    expect(env).not.toMatch(/ci-Password/);
  });

  it("D-017 文字起こし2本は .gitignore で除外されている", () => {
    const ig = readFileSync(join(repoRoot, ".gitignore"), "utf8");
    expect(ig).toContain("docs/sources/20261002_195452_話者別文字起こし.md");
    expect(ig).toContain("docs/sources/新規録音_話者別文字起こし.md");
  });
});
