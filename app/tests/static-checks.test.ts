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
    for (const f of [...srcFiles, join(appDir, "next.config.ts"), join(appDir, "tests/global-setup.ts")]) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]);
      for (const m of text.matchAll(/getEnv\(\s*["']([A-Z][A-Z0-9_]+)["']\s*\)/g)) used.add(m[1]);
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
    const patterns = [/eyJ[A-Za-z0-9_-]{20,}/, /sk-[A-Za-z0-9]{20,}/, /sb_secret_[A-Za-z0-9]+/, /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s]+@/];
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
