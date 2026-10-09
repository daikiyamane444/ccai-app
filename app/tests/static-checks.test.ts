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
    for (const skip of ["NODE_ENV", "NEXT_RUNTIME", "VITEST", "VERCEL", "PATH"]) used.delete(skip);
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

  it("privileged を読み込むのは、決められた3か所だけ（アカウント削除の処理、認証アダプタ、LLM の入口）", () => {
    const allowed = ["src/server/auth/supabase.ts", "src/server/services/account.ts", "src/server/llm/index.ts"];
    const users = srcFiles
      .filter((f) => !rel(f).startsWith("src/server/privileged/"))
      .filter((f) => /from\s+["'](\.\.?\/)+privileged(\/[a-z-]+)?["']|@\/server\/privileged/.test(readFileSync(f, "utf8")))
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
    // LLM は承認済み（D-010）の Claude Agent SDK だけを開発用の依存として許す（本番では使わない。SPEC-000b）
    const allowedLlm = ["@anthropic-ai/claude-agent-sdk"];
    expect(all.filter((n) => !allowedLlm.includes(n) && /sentry|datadog|posthog|analytics|mixpanel|resend|nodemailer|sendgrid|mailgun|openai|anthropic|claude|gemini|web-push|firebase|langchain|ai-sdk|^ai$/i.test(n))).toEqual([]);
    expect(Object.keys(pkg.dependencies)).not.toContain("@anthropic-ai/claude-agent-sdk");
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
    // 対象は「決まった形のアドレス」か「この実行で作ったユーザー（IDで記録）」だけ
    expect(env).toMatch(/filter\(\(u\) => isCiEmail\(u\.email\) \|\| ctx\.created\.has\(u\.id\)\)/);
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
    expect(env).toMatch(/PASSWORD = process\.env\.CI_TEST_PASSWORD \|\| `Ci-\$\{randomBytes\(/);
    expect(read("scripts/run-integration.mjs")).toMatch(/const testPassword = `Ci-\$\{randomBytes\(/);
    expect(env).not.toMatch(/ci-Password/);
  });

  it("D-017 文字起こし2本は .gitignore で除外されている", () => {
    const ig = readFileSync(join(repoRoot, ".gitignore"), "utf8");
    expect(ig).toContain("docs/sources/20261002_195452_話者別文字起こし.md");
    expect(ig).toContain("docs/sources/新規録音_話者別文字起こし.md");
  });
});

describe("結合テストの値の出し方（2026-10-08 初回実行の失敗を受けて）", () => {
  const integrationFiles = walk(join(appDir, "tests/integration"), (x) => /\.ts$/.test(x));
  const testFiles = integrationFiles.filter((f) => !f.endsWith("/lib.ts"));

  it("結合テスト（lib.ts 以外）は expect を直接使わない。値を出さない確かめ方（ok / sameNumber / sameCode / emptyLabels）だけを使う", () => {
    expect(testFiles.length).toBeGreaterThan(0);
    for (const f of testFiles) {
      const text = readFileSync(f, "utf8");
      expect(text, rel(f)).not.toMatch(/\bexpect\s*\(|\bassert\s*\(|\.toBeNull\(|\.toEqual\(|\.toBe\(/);
      expect(text, rel(f)).not.toMatch(/import\s*\{[^}]*\bexpect\b[^}]*\}\s*from\s*["']vitest["']/);
    }
  });

  it("値を出さない確かめ方は、真偽・数値・コードの形（英小文字・数字・_・:）だけを expect に渡す", () => {
    const lib = read("tests/integration/lib.ts");
    const calls = [...lib.matchAll(/expect\(([^,]+),/g)].map((m) => m[1].trim());
    expect(calls.sort()).toEqual(["[...labels]", "cond", "shown", 'typeof actual === "number" ? actual : Number.NaN'].sort());
  });

  it("テスト用アドレスを組み立てるのは lib.ts の ciEmail だけ（他のファイルに「@example.invalid」を書かない）", () => {
    for (const f of testFiles) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/`[^`]*@example\.invalid|"[^"]*@example\.invalid|'[^']*@example\.invalid/);
  });

  it("結合テストは伏せ字つきの起動スクリプトから動かす（npm の test:integration・test:integration:long）", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["test:integration"]).toMatch(/^node scripts\/run-integration\.mjs /);
    expect(pkg.scripts["test:integration:long"]).toMatch(/^node scripts\/run-integration\.mjs /);
  });

  it("結合テストの設定は、ファイルを1つずつ順番に流す", () => {
    const cfg = read("vitest.integration.config.ts");
    expect(cfg).toMatch(/fileParallelism:\s*false/);
    expect(cfg).toMatch(/maxWorkers:\s*1/);
  });
});

// ---- QA v2 の L-1・L-2: トークンを出力に混ぜる書き方を禁止する ----
const TOKEN_IDENT = /\b(tokens|accessToken|refreshToken|access_token|refresh_token|PASSWORD|password|setCookie|cookie)\b/;
// 例外として許す2か所（どちらも出力ではなく、要求に付ける値）
const ALLOWED_TEMPLATES = ["`Bearer ${t.tokens.accessToken}`", "`${SESSION_COOKIE}=${encodeSession(t.tokens)}`"];

/** 位置 i の「(」に対応する「)」までの中身を、トップレベルの「,」で分けて返す（文字列・テンプレート内の記号は無視） */
function splitArgs(src: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let cur = "";
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      cur += ch;
      if (ch === "\\") {
        cur += src[++i] ?? "";
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      cur += ch;
      continue;
    }
    if ("([{".includes(ch)) {
      depth++;
      if (depth === 1 && ch === "(") continue;
    } else if (")]}".includes(ch)) {
      depth--;
      if (depth === 0) {
        args.push(cur.trim());
        return args;
      }
    } else if (ch === "," && depth === 1) {
      args.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  return args;
}

/** 結合テストのソースから、トークンが出力に混ざりうる書き方を探す（見つかった箇所の説明を返す。値は含まない） */
export function tokenLeakFindings(src: string): string[] {
  const code = src.replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  // 1. テンプレート文字列の ${…} にトークンの変数（例外2か所を除く）
  for (const m of code.matchAll(/`(?:[^`\\]|\\.)*`/g)) {
    if (ALLOWED_TEMPLATES.includes(m[0])) continue;
    for (const e of m[0].matchAll(/\$\{([^}]*)\}/g)) if (TOKEN_IDENT.test(e[1])) out.push(`テンプレート文字列: ${m[0].slice(0, 40)}`);
  }
  // 2. Error(…) の引数にトークンの変数
  for (const m of code.matchAll(/\bError\s*\(/g)) {
    const args = splitArgs(code, m.index! + m[0].length - 1);
    if (args.some((a) => TOKEN_IDENT.test(a.replace(/"[^"]*"|'[^']*'/g, "")))) out.push("Error の引数");
  }
  // 3. 確かめる部品の説明文（最後の引数）は、文字列かテンプレート文字列だけ。トークンの変数を入れない
  for (const m of code.matchAll(/\b(ok|sameNumber|sameCode|emptyLabels)\s*\(/g)) {
    if (/function\s+$/.test(code.slice(Math.max(0, m.index! - 9), m.index!))) continue; // 定義そのもの
    const args = splitArgs(code, m.index! + m[0].length - 1);
    const label = args[args.length - 1] ?? "";
    if (!/^(["'`])[\s\S]*\1$/.test(label)) out.push(`${m[1]} の説明文が文字列でない`);
    else if (label.startsWith("`") && [...label.matchAll(/\$\{([^}]*)\}/g)].some((e) => TOKEN_IDENT.test(e[1]))) out.push(`${m[1]} の説明文にトークン`);
  }
  // 4. 投げる値・console への出力は別の検査（console 禁止）で見る
  return [...new Set(out)];
}

describe("QA v2 L-1 トークンを説明文・テンプレート文字列・Error に入れない", () => {
  const files = walk(join(appDir, "tests/integration"), (x) => /\.ts$/.test(x));

  it("結合テストのコードに、トークンが出力に混ざりうる書き方がない（例外は Bearer ヘッダーと encodeSession の2か所）", () => {
    for (const f of files) expect(tokenLeakFindings(readFileSync(f, "utf8")), rel(f)).toEqual([]);
    // 例外の2か所は実際に使われている（例外の一覧が古くならないように）
    const all = files.map((f) => readFileSync(f, "utf8")).join("\n");
    for (const t of ALLOWED_TEMPLATES) expect(all).toContain(t);
  });

  it("（検査の検査）悪い書き方を検出する: 説明文にトークン（S3）、Error にトークン（S4）、テンプレートにトークン、説明文が変数", () => {
    const bad = {
      S3: "ok(x === null, `更新は拒否 ${t1.refreshToken}`);",
      S4: 'throw new Error("refresh failed " + t2.refreshToken);',
      template: "const s = `token=${r.tokens.accessToken}`;",
      labelVar: "ok(x, t2.refreshToken);",
      cookie: "sameNumber(res.status, 200, `cookie ${setCookie}`);",
    };
    for (const [k, src] of Object.entries(bad)) expect(tokenLeakFindings(src).length, k).toBeGreaterThan(0);
    const good = [
      'ok((await supabaseAuth.refresh(t1.refreshToken)) === null, "親のリフレッシュトークンでの更新は拒否");',
      'ok(x, `${when}: いまのアクセストークン`);',
      "const withToken = await call({ Authorization: `Bearer ${t.tokens.accessToken}` });",
      'throw new Error(`createUser failed: ${error?.code ?? "unknown"}`);',
    ];
    for (const src of good) expect(tokenLeakFindings(src), src).toEqual([]);
  });
});

describe("QA v2 L-2 ワークフローは伏せ字つきの起動スクリプト経由で結合テストを動かす", () => {
  const workflow = readFileSync(join(resolve(appDir, ".."), ".github/workflows/integration.yml"), "utf8").replace(/^\s*#.*$/gm, "");
  const runs = [...workflow.matchAll(/^[ \t]*-?[ \t]*run:[ \t]*(\S.*)$/gm)].map((m) => m[1].trim());

  it("結合テストの起動は npm run test:integration と test:integration:long だけ（vitest・npx・node の直接起動がない）", () => {
    expect(runs).toContain("npm run test:integration");
    expect(runs).toContain("npm run test:integration:long");
    for (const r of runs) {
      expect(r, r).not.toMatch(/\bvitest\b|\bnpx\b|\bnode\b|itest|vitest\.integration/);
      expect(["npm ci", "npm test", "npm run test:integration", "npm run test:integration:long", "npm run ci:cleanup"], r).toContain(r);
    }
  });

  it("秘密を受け取るステップは、結合テスト（起動スクリプト経由）と後片付けだけ", () => {
    const steps = workflow.split(/\n\s+- /).filter((s) => /secrets\./.test(s));
    expect(steps.length).toBe(4);
    for (const s of steps) expect(s).toMatch(/^run: npm run (test:integration(:long)?|ci:cleanup)\b/);
  });
});

describe("SPEC-000b LLM の静的確認（AC-1, AC-3, AC-12, AC-15, AC-17）", () => {
  const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");
  const codeFiles = [...srcFiles, ...walk(join(appDir, "scripts"), (f) => /\.(ts|mjs|js)$/.test(f))];

  it("AC-1 Agent SDK を直接使うのはプラン方式のアダプタ（src/server/llm/plan.ts）だけ。Anthropic の他の SDK・API は直接使わない", () => {
    // check-build.mjs は「成果物に含まれていないこと」を確かめるために名前を持つだけなので除く
    const users = codeFiles.filter((f) => !f.endsWith("check-build.mjs") && /claude-agent-sdk/.test(stripComments(readFileSync(f, "utf8")))).map(rel);
    expect(users).toEqual(["src/server/llm/plan.ts"]);
    for (const f of codeFiles.filter((x) => !x.endsWith("check-build.mjs"))) {
      const t = stripComments(readFileSync(f, "utf8"));
      expect(t, rel(f)).not.toMatch(/@anthropic-ai\/sdk|api\.anthropic\.com|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN/);
    }
  });

  it("AC-1 モックとプラン方式が同じ共通の形（LlmAdapter）を実装し、共通の形が README にある", () => {
    expect(read("src/server/llm/mock.ts")).toMatch(/class MockAdapter implements LlmAdapter/);
    expect(read("src/server/llm/plan.ts")).toMatch(/class PlanAdapter implements LlmAdapter/);
    const readme = read("README.md");
    for (const w of ["LlmAdapter", "AdapterRequest", "AdapterResponse", "AdapterErrorKind"]) expect(readme).toContain(w);
  });

  it("AC-17 画面・API（src/app）から LLM の部品を読み込んでいない（利用者向けの AI 機能はまだない）。APIキー方式のアダプタがない", () => {
    for (const f of srcFiles.filter((x) => rel(x).startsWith("src/app/") || rel(x).startsWith("src/components/"))) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/server\/llm|\.\.\/llm|claude-agent-sdk/);
    }
    expect(readdirSync(join(appDir, "src/server/llm")).sort()).toEqual(["config.ts", "eval.ts", "gateway.ts", "index.ts", "memory-store.ts", "mock.ts", "plan.ts", "prompts.ts", "time.ts", "types.ts"]);
  });

  it("Agent SDK は開発用の依存だけで、公開用の関数に含めない設定がある", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.devDependencies["@anthropic-ai/claude-agent-sdk"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(read("next.config.ts")).toMatch(/outputFileTracingExcludes:\s*\{\s*"\*":\s*\["node_modules\/@anthropic-ai\/\*\*"\]/);
  });

  it("AC-12 プロンプトの置き場と形（README とサンプル。サンプルの先頭に SPEC 番号・目的・版）", () => {
    expect(existsSync(join(appDir, "prompts/README.md"))).toBe(true);
    const sample = read("prompts/_sample.md");
    expect(sample).toMatch(/^---\nspec: SPEC-000b\npurpose: .+\nversion: \d+\n/);
  });

  it("AC-15 .env.example に LLM の環境変数が説明つきで並び、README に評価コマンドと認証情報の用意の手順がある", () => {
    const ex = read(".env.example");
    for (const n of ["LLM_MODE", "LLM_MODEL", "CLAUDE_CODE_OAUTH_TOKEN", "LLM_DAILY_CALL_LIMIT", "LLM_MONTHLY_BUDGET_JPY", "LLM_MAX_OUTPUT_TOKENS", "LLM_PRICE_PRIMARY_INPUT_USD", "LLM_PRICE_PRIMARY_OUTPUT_USD", "LLM_PRICE_ALTERNATE_INPUT_USD", "LLM_PRICE_ALTERNATE_OUTPUT_USD", "LLM_USD_JPY", "LLM_TIMEOUT_MS"]) {
      expect(ex, n).toMatch(new RegExp(`^${n}=`, "m"));
    }
    const readme = read("README.md");
    expect(readme).toMatch(/npm run eval -- --prompt _sample/);
    expect(readme).toMatch(/claude setup-token/);
  });

  it("LLM の部品はログに本文を出さない（console に渡すのは固定の文字列と種類だけ）", () => {
    for (const f of walk(join(appDir, "src/server/llm"))) {
      for (const m of readFileSync(f, "utf8").matchAll(/console\.(log|error|warn|info|debug)\(([^)]*)\)/g)) {
        expect(m[2].replace(/"[^"]*"|'[^']*'/g, '""'), rel(f)).not.toMatch(/input|text|system|prompt\.|req\b|call\b|res\b/);
      }
    }
  });
});
