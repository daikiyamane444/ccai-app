/**
 * LLM 呼び出しの共通部分（SPEC-000b）。アプリのすべての LLM 呼び出しは、この callLlm を通す。
 * 守ること:
 * - 上限（1日の回数・月間の推定費用・最大出力トークン）、タイムアウト、利用記録、月次集計を、呼び出し側が意識しなくても当てはめる
 * - 入力・応答の本文を、ログ・利用記録・月次集計・エラーに出さない（エラーは種類だけ）
 * - 自動テストの実行中は、設定にかかわらずモックを使う（selectAdapter）
 * - プラン方式は本番（Vercel・production）では使わない（規約。docs/architecture.md 13-2）
 */
import { AdapterError, type AdapterErrorKind, type LlmAdapter, type LlmOwner, type LlmResult, type UsageStore } from "./types";
import { conservativeInputTokens, estimateJpy, missingForPlan, readLlmConfig, type LlmConfig } from "./config";
import { loadPrompt, PromptNotFoundError, PROMPT_NAME_RE } from "./prompts";
import { jstDayRange, jstMonth } from "./time";
import { MockAdapter } from "./mock";
import { PlanAdapter } from "./plan";
import { getEnv } from "../config";

/** 利用者向けの固定文（日本語） */
export const LLM_MSG = {
  limit: "今日はAIの利用上限に達しました。明日またお試しください",
  unavailable: "AIの応答を受け取れませんでした。しばらくしてからもう一度お試しください",
  notConfigured: "AIの設定が完了していません",
} as const;

export type CallInput = { owner: LlmOwner; promptName: string; input: string };
export type CallOutcome =
  | { ok: true; text: string; inputTokens: number; outputTokens: number; costJpy: number; promptVersion: string }
  | { ok: false; result: Exclude<LlmResult, "success">; errorKind: string; message: string };

export type GatewayDeps = {
  adapter: LlmAdapter;
  store: UsageStore;
  config: LlmConfig;
  now?: () => Date;
  promptsDir?: string;
  /** 再試行の前の待ち時間（テストで0にする） */
  retryDelayMs?: number;
};

/** 自動テストの実行中か（vitest が設定する環境変数で判断） */
export function isTestRun(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

/** 本番（公開環境）か。プラン方式はここでは使わない */
export function isDeployedRuntime(): boolean {
  return !!process.env.VERCEL || process.env.NODE_ENV === "production";
}

/**
 * 設定から実行方式のアダプタを選ぶ。
 * - 自動テストの実行中は、設定にかかわらずモック（AC-2）
 * - プラン方式は、本番では選ばない（呼び出しは「設定不足」になる）
 */
export function selectAdapter(config: LlmConfig): LlmAdapter {
  if (isTestRun() || config.mode === "mock") return new MockAdapter();
  const credential = getEnv("CLAUDE_CODE_OAUTH_TOKEN");
  return new PlanAdapter(credential ?? "");
}

export function defaultGatewayConfig(): LlmConfig {
  return readLlmConfig();
}

const RETRYABLE: AdapterErrorKind[] = ["timeout", "transient"];

export async function callLlm(deps: GatewayDeps, call: CallInput): Promise<CallOutcome> {
  const now = deps.now ?? (() => new Date());
  const at = now();
  const c = deps.config;
  const mode = deps.adapter.mode;
  const promptName = PROMPT_NAME_RE.test(call.promptName) ? call.promptName : "(invalid)";
  const base = { owner: call.owner, at, promptName, mode, model: c.model } as const;
  const fail = (result: Exclude<LlmResult, "success">, errorKind: string): CallOutcome => ({
    ok: false,
    result,
    errorKind,
    message: result === "limit_exceeded" || errorKind === "plan_limit" ? LLM_MSG.limit : result === "config_missing" ? LLM_MSG.notConfigured : LLM_MSG.unavailable,
  });

  // 1. プロンプト（存在しない名前はプロバイダを呼ばない）
  let prompt;
  try {
    prompt = await loadPrompt(call.promptName, deps.promptsDir);
  } catch (e) {
    if (!(e instanceof PromptNotFoundError)) throw e;
    await deps.store.reject({ ...base, result: "config_missing", errorKind: "unknown_prompt" });
    return fail("config_missing", "unknown_prompt");
  }

  // 2. 設定（プラン方式は、上限・単価・為替・認証情報がすべて必要。本番では使わない）
  if (mode === "plan") {
    const missing = missingForPlan(c);
    if (isDeployedRuntime()) missing.unshift("deployed_runtime");
    if (missing.length) {
      await deps.store.reject({ ...base, result: "config_missing", errorKind: missing[0] });
      return fail("config_missing", missing[0]);
    }
  }
  const maxOut = c.maxOutputTokens ?? 800;
  const timeoutMs = c.timeoutMs ?? 30_000;

  // 3. 予約（1日の回数・月間の残り）。超えていればプロバイダを呼ばない
  const estIn = conservativeInputTokens(prompt.system, call.input);
  const reserveJpy = estimateJpy(c, estIn, maxOut);
  const day = jstDayRange(at);
  const month = jstMonth(at);
  const r = await deps.store.reserve({
    ...base,
    month,
    dayStart: day.start,
    dayEnd: day.end,
    dailyLimit: call.owner.kind === "system" ? null : c.dailyCallLimit,
    monthlyBudgetJpy: c.monthlyBudgetJpy,
    reserveJpy,
  });
  if (!r.ok) return fail("limit_exceeded", r.reason === "daily" ? "daily_limit" : "monthly_limit");

  // 4. 呼び出し（タイムアウト。一時的な失敗は1回だけ再試行。再試行は元の呼び出しと合わせて1回と数える）
  let lastKind: AdapterErrorKind = "unknown";
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await deps.adapter.generate({ promptName: prompt.name, system: prompt.system, input: call.input, model: c.model, maxOutputTokens: maxOut, signal: ac.signal });
      const costJpy = estimateJpy(c, res.inputTokens, res.outputTokens);
      await deps.store.finalize({ id: r.id, month, result: "success", inputTokens: res.inputTokens, outputTokens: res.outputTokens, costJpy, sentToProvider: true });
      return { ok: true, text: res.text, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costJpy, promptVersion: prompt.version };
    } catch (e) {
      lastKind = e instanceof AdapterError ? e.kind : ac.signal.aborted ? "timeout" : "unknown";
      if (!RETRYABLE.includes(lastKind) || attempt === 1) break;
      if (deps.retryDelayMs) await new Promise((res) => setTimeout(res, deps.retryDelayMs));
    } finally {
      clearTimeout(timer);
    }
  }

  // 5. 失敗の確定。実際のトークン数が分からないので、予約した見込みのまま確定する（少なく数えない）
  const result: LlmResult = lastKind === "timeout" ? "timeout" : "failure";
  await deps.store.finalize({ id: r.id, month, result, errorKind: lastKind, inputTokens: null, outputTokens: null, costJpy: reserveJpy, sentToProvider: true });
  // 本文を含めず、種類だけをログに出す
  console.error("llm call failed", result, lastKind);
  return fail(result, lastKind);
}
