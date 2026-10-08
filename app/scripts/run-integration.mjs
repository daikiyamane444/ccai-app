// 結合テストの起動（npm run test:integration / test:integration:long）。
// vitest の出力を1行ずつ受け取り、伏せ字にしてから表示する（保険）。
// 伏せ字の対象は次のものだけ: 環境変数の値（キー・DBのホストとパスワード・プロジェクトURLとID・CI_LEAK_PROBE）、テスト用パスワード、
// JWT の形（アクセストークン）、sb_secret_／sb_publishable_ の形のキー、メールアドレス、「refresh_token: 値」のように名前つきで出た値。
// **リフレッシュトークンそのもの（名前なしで出た値）は、形で見分けられないので伏せられない。**
// リフレッシュトークンを含むトークンの値は、テストの書き方の規則（tests/integration/lib.ts の ok / sameNumber / sameCode / emptyLabels だけを使い、
// トークンを説明文・テンプレート文字列・Error に入れない。static-checks が強制）で出さない。これが第一の守り。
// 使い方: node scripts/run-integration.mjs <テストファイルの絞り込み...>
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// テスト用ユーザーのパスワードは、ここで実行ごとに作る（伏せ字の対象にできるように）
const testPassword = `Ci-${randomBytes(18).toString("hex")}`;
const env = { ...process.env, CI_TEST_PASSWORD: testPassword, NO_COLOR: "1" };
delete env.FORCE_COLOR;

/** 伏せ字にする値（長いものから順に置き換える） */
export function secretValues(e) {
  const names = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "DB_PASSWORD", "DB_HOST", "SUPABASE_URL", "CI_LEAK_PROBE", "CI_TEST_PASSWORD"];
  const values = [];
  for (const n of names) {
    const v = (e[n] ?? "").trim();
    if (v.length >= 6) values.push(v);
    if (n === "SUPABASE_URL" && v) {
      try {
        const ref = new URL(v).hostname.split(".")[0];
        if (ref.length >= 6) values.push(ref); // プロジェクトID
      } catch {}
    }
  }
  return [...new Set(values)].sort((a, b) => b.length - a.length);
}

/** 1行を伏せ字にする */
export function redactLine(line, values) {
  // 色付けの制御文字で値が分断されないよう、先に取り除く
  let out = line
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[伏せ字:JWT]")
    .replace(/\b(sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,})/g, "[伏せ字:キー]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[伏せ字:メール]")
    .replace(/\b(access_token|refresh_token|password)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1$2[伏せ字]");
  for (const v of values) out = out.split(v).join("[伏せ字]");
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const values = secretValues(env);
  const child = spawn("npx", ["vitest", "run", "-c", "vitest.integration.config.ts", ...process.argv.slice(2)], {
    cwd: appDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pipe = (from, to) => {
    let buf = "";
    from.setEncoding("utf8");
    from.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) to.write(redactLine(l, values) + "\n");
    });
    from.on("end", () => {
      if (buf) to.write(redactLine(buf, values) + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("close", (code) => process.exit(code ?? 1));
}
