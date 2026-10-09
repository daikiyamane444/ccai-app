// 評価コマンド（SPEC-000b）。使い方は app/README.md「評価コマンド」。
//   npm run eval -- --prompt _sample                 試走（モック。認証情報・DB・外部通信なし）
//   npm run eval -- --prompt _sample --cases EV-01,EV-03
//   npm run eval -- --prompt _sample --real [--model alternate]   実LLM（プラン方式。設定は .env.example）
// 表示するのは件数・推定最大消費・保存先だけ。本文・設定値・認証情報は表示しない。
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readLlmConfig, type ModelSlot } from "../src/server/llm/config";
import { MockAdapter } from "../src/server/llm/mock";
import { MemoryUsageStore } from "../src/server/llm/memory-store";
import { EvalError, runEval } from "../src/server/llm/eval";
import type { GatewayDeps } from "../src/server/llm/gateway";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appDir, "..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const promptName = arg("prompt");
  if (!promptName) throw new EvalError("--prompt <名前> を指定してください");
  const real = flag("real");
  const slot = (arg("model") === "alternate" ? "alternate" : "primary") as ModelSlot;
  const caseIds = arg("cases")?.split(",").map((s) => s.trim()).filter(Boolean);
  const outDir = arg("out-dir") ? resolve(arg("out-dir")!) : join(repoRoot, "docs/reviews/eval-runs");
  const casesFile = join(repoRoot, "docs/reviews/eval-cases.md");

  let deps: GatewayDeps;
  let close = async () => {};
  if (!real) {
    deps = { adapter: new MockAdapter(), store: new MemoryUsageStore(), config: readLlmConfig(undefined, { mode: "mock", slot }), promptsDir: join(appDir, "prompts") };
  } else {
    const config = readLlmConfig(undefined, { mode: "plan", slot });
    const { PlanAdapter } = await import("../src/server/llm/plan");
    const { createDb } = await import("../src/server/db/pool");
    const { buildDatabaseConnection } = await import("../src/server/config");
    const { createDbUsageStore } = await import("../src/server/privileged/llm-usage");
    let db;
    try {
      db = createDb(buildDatabaseConnection());
    } catch {
      throw new EvalError("実LLMの評価には DB の接続情報が必要です（月次集計に記録するため。.env.example を参照）");
    }
    close = async () => db!.pool.end();
    deps = { adapter: new PlanAdapter(process.env.CLAUDE_CODE_OAUTH_TOKEN ?? ""), store: createDbUsageStore(db), config, promptsDir: join(appDir, "prompts") };
  }
  try {
    await runEval({ promptName, real, caseIds, casesFile, outDir, deps, log: (l) => console.log(`[eval] ${l}`) });
  } finally {
    await close();
  }
}

main().catch((e) => {
  // EvalError の文言は固定文と件数・IDだけ。それ以外の例外は種類だけを出す（本文・認証情報を出さない）
  console.error(`[eval] 中止: ${e instanceof EvalError ? e.message : (e as Error)?.name ?? "error"}`);
  process.exit(1);
});
