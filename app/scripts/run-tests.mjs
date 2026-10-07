// 全自動テストを1コマンドで実行する: vitest（DB・認証・静的確認）→ ビルド確認（ビルド成果物の検査・起動して疎通）
// .env も認証情報も不要。
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args) => spawnSync(cmd, args, { cwd: appDir, stdio: "inherit", env: process.env }).status ?? 1;

const unit = run("npx", ["vitest", "run"]);
if (unit !== 0) {
  console.error("\n[npm test] vitest が失敗したため、ビルド確認は実行しません");
  process.exit(unit);
}
process.exit(run("node", ["scripts/check-build.mjs"]));
