/**
 * 評価コマンドの本体（SPEC-000b 第4章）。CLI は scripts/eval.ts。
 * - 評価ケースは docs/reviews/eval-cases.md の表（EV-xx）から読む（架空の入力）
 * - 結果は docs/reviews/eval-runs/YYYYMMDD-HHMM-<プロンプト名>.md（日本時間）に保存する
 * - 結果ファイルに認証情報や設定値（単価・上限・為替）を書かない
 * - 実LLM: 認証情報などが足りなければ何も送らずに止まる。推定最大消費が月間の残りを超えるなら実行しない。開始前に件数と推定最大消費を表示する
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { callLlm, isDeployedRuntime, type GatewayDeps } from "./gateway";
import { conservativeInputTokens, estimateJpy, missingForPlan } from "./config";
import { loadPrompt, PromptNotFoundError } from "./prompts";
import { jstIso, jstMonth, jstStamp } from "./time";

export type EvalCase = { id: string; aspect: string; input: string; expected: string; ng: string };

export class EvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalError";
  }
}

export function parseEvalCases(markdown: string): EvalCase[] {
  const out: EvalCase[] = [];
  for (const line of markdown.split("\n")) {
    if (!/^\|\s*EV-\d+\s*\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((s) => s.trim());
    if (cells.length < 5) continue;
    const strip = (s: string) => s.replace(/^「(.*)」$/, "$1");
    out.push({ id: cells[0], aspect: cells[1], input: strip(cells[2]), expected: cells[3], ng: cells[4] });
  }
  return out;
}

export type EvalOptions = {
  promptName: string;
  real: boolean;
  caseIds?: string[];
  casesFile: string;
  outDir: string;
  deps: GatewayDeps;
  now?: () => Date;
  /** 進み具合の表示（件数・推定最大消費・保存先だけ。本文は出さない） */
  log?: (line: string) => void;
};

export async function runEval(o: EvalOptions): Promise<{ file: string; count: number; estimatedMaxJpy: number }> {
  const now = o.now ?? (() => new Date());
  const log = o.log ?? (() => undefined);
  const c = o.deps.config;

  // 1. 評価ケース（読めない・該当なしなら、何も送らずに止まる）
  let md: string;
  try {
    md = await readFile(o.casesFile, "utf8");
  } catch {
    throw new EvalError("評価ケースのファイルを読めません（docs/reviews/eval-cases.md）");
  }
  let cases = parseEvalCases(md);
  if (!cases.length) throw new EvalError("評価ケースの表が読めません");
  if (o.caseIds?.length) {
    const missing = o.caseIds.filter((id) => !cases.some((x) => x.id === id));
    if (missing.length) throw new EvalError(`該当する評価ケースがありません: ${missing.join(", ")}`);
    cases = cases.filter((x) => o.caseIds!.includes(x.id));
  }

  // 2. プロンプト
  let prompt;
  try {
    prompt = await loadPrompt(o.promptName, o.deps.promptsDir);
  } catch (e) {
    if (e instanceof PromptNotFoundError) throw new EvalError("プロンプトが見つかりません（app/prompts/<名前>.md）");
    throw e;
  }

  // 3. 実LLMの事前確認（何も送らない段階）
  const maxOut = c.maxOutputTokens ?? 800;
  const estimatedMaxJpy = cases.reduce((sum, x) => sum + estimateJpy(c, conservativeInputTokens(prompt.system, x.input), maxOut), 0);
  if (o.real) {
    if (o.deps.adapter.mode !== "plan") throw new EvalError("実LLMにはプラン方式のアダプタが必要です");
    if (isDeployedRuntime()) throw new EvalError("公開環境では実LLMの評価を実行しません");
    const missing = missingForPlan(c);
    if (missing.length) throw new EvalError(`実LLMの設定が足りません（不足: ${missing.join(", ")}）。.env.example を参照`);
    const remaining = await o.deps.store.monthlyRemaining(jstMonth(now()), c.monthlyBudgetJpy!);
    if (estimatedMaxJpy > remaining) throw new EvalError("推定最大消費が今月の上限の残りを超えるため、実行しません");
  }
  log(`評価ケース ${cases.length} 件、推定最大消費 ${estimatedMaxJpy.toFixed(2)} 円（${o.real ? "実LLM" : "試走（モック）"}）`);

  // 4. 実行（評価分は「システム」所有。1日の回数には数えず、月次集計には加える）
  const started = now();
  const rows: string[] = [];
  let totalIn = 0;
  let totalOut = 0;
  let totalJpy = 0;
  for (const x of cases) {
    const r = await callLlm(o.deps, { owner: { kind: "system" }, promptName: o.promptName, input: x.input });
    if (r.ok) {
      totalIn += r.inputTokens;
      totalOut += r.outputTokens;
      totalJpy += r.costJpy;
    }
    rows.push(
      [
        `### ${x.id}（${x.aspect}）`,
        "",
        `- 入力: ${x.input}`,
        `- 期待する振る舞い: ${x.expected}`,
        `- NGな振る舞い: ${x.ng}`,
        `- 結果: ${r.ok ? "成功" : `${r.result}（${r.errorKind}）`}`,
        `- トークン数: ${r.ok ? `入力 ${r.inputTokens} / 出力 ${r.outputTokens}` : "不明"}`,
        `- 推定費用: ${r.ok ? `${r.costJpy.toFixed(4)} 円` : "—"}`,
        "",
        "応答:",
        "",
        ...(r.ok ? r.text.split("\n").map((l) => `> ${l}`) : ["> （応答なし）"]),
        "",
      ].join("\n"),
    );
  }

  // 5. 保存（設定値・認証情報は書かない）
  const file = join(o.outDir, `${jstStamp(started)}-${o.promptName}.md`);
  const body = [
    `# 評価結果: ${o.promptName}`,
    "",
    `- 実行日時: ${jstIso(started)}`,
    `- 実行方式: ${o.deps.adapter.mode === "plan" ? "プラン方式（Claude Agent SDK）" : "モック"}`,
    `- 試走か実LLMか: ${o.real ? "実LLM" : "試走"}`,
    `- モデル名: ${c.model}（${c.slot === "primary" ? "主案" : "代替"}）`,
    `- プロンプト: ${prompt.name}（${prompt.spec}、版 ${prompt.version}）`,
    `- 評価ケース: ${cases.map((x) => x.id).join(", ")}`,
    `- 合計: 入力 ${totalIn} トークン / 出力 ${totalOut} トークン / 推定費用 ${totalJpy.toFixed(4)} 円`,
    "",
    "## ケースごとの結果",
    "",
    ...rows,
  ].join("\n");
  await mkdir(o.outDir, { recursive: true });
  await writeFile(file, body, "utf8");
  log(`保存しました: ${file}`);
  return { file, count: cases.length, estimatedMaxJpy };
}
