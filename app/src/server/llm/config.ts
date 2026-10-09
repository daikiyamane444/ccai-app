/**
 * LLM の設定（環境変数）。値の名前と意味は .env.example。
 * 上限・単価・為替が未設定・不正なら、実プロバイダ（プラン方式）への呼び出しはすべて「設定不足」で拒否する。
 * モックは、設定があれば同じ上限を当てはめ、なければ上限なし・費用0で動く（自動テスト・試走用）。
 */
import { getEnv } from "../config";

export type ModelSlot = "primary" | "alternate";
export type LlmMode = "mock" | "plan";

export type LlmConfig = {
  mode: LlmMode;
  slot: ModelSlot;
  model: string;
  /** USD / 100万トークン。未設定は null */
  priceInUsd: number | null;
  priceOutUsd: number | null;
  usdJpy: number | null;
  dailyCallLimit: number | null;
  monthlyBudgetJpy: number | null;
  maxOutputTokens: number | null;
  timeoutMs: number | null;
  /** プラン方式の認証情報があるか（値そのものは持たない） */
  hasPlanCredential: boolean;
};

export const DEFAULT_MODELS: Record<ModelSlot, string> = {
  primary: "claude-sonnet-5-5",
  alternate: "claude-haiku-4-5-20251001",
};

function num(v: string | undefined, opts: { int?: boolean; min: number; max: number }): number | null {
  if (v === undefined) return null;
  if (!/^[0-9]+(\.[0-9]+)?$/.test(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < opts.min || n > opts.max) return null;
  if (opts.int && !Number.isInteger(n)) return null;
  return n;
}

export function readLlmConfig(read: (name: string) => string | undefined = getEnv, overrides: { slot?: ModelSlot; mode?: LlmMode } = {}): LlmConfig {
  const rawMode = read("LLM_MODE");
  const mode: LlmMode = overrides.mode ?? (rawMode === "plan" ? "plan" : "mock");
  const slotRaw = overrides.slot ?? read("LLM_MODEL");
  const slot: ModelSlot = slotRaw === "alternate" ? "alternate" : "primary";
  const S = slot.toUpperCase();
  const model = read(`LLM_MODEL_${S}_ID`) ?? DEFAULT_MODELS[slot];
  return {
    mode,
    slot,
    model: /^[a-z0-9.-]{1,100}$/.test(model) ? model : DEFAULT_MODELS[slot],
    priceInUsd: num(read(`LLM_PRICE_${S}_INPUT_USD`), { min: 0.0001, max: 1000 }),
    priceOutUsd: num(read(`LLM_PRICE_${S}_OUTPUT_USD`), { min: 0.0001, max: 1000 }),
    usdJpy: num(read("LLM_USD_JPY"), { min: 1, max: 10000 }),
    dailyCallLimit: num(read("LLM_DAILY_CALL_LIMIT"), { int: true, min: 1, max: 100000 }),
    monthlyBudgetJpy: num(read("LLM_MONTHLY_BUDGET_JPY"), { min: 1, max: 10_000_000 }),
    maxOutputTokens: num(read("LLM_MAX_OUTPUT_TOKENS"), { int: true, min: 1, max: 64000 }),
    timeoutMs: num(read("LLM_TIMEOUT_MS"), { int: true, min: 1000, max: 600000 }),
    hasPlanCredential: !!read("CLAUDE_CODE_OAUTH_TOKEN"),
  };
}

/** プラン方式で呼ぶのに足りない設定の種類（空なら足りている）。値は返さない */
export function missingForPlan(c: LlmConfig): string[] {
  const out: string[] = [];
  if (!c.hasPlanCredential) out.push("credential");
  if (c.priceInUsd === null || c.priceOutUsd === null) out.push("price");
  if (c.usdJpy === null) out.push("fx");
  if (c.dailyCallLimit === null) out.push("daily_limit");
  if (c.monthlyBudgetJpy === null) out.push("monthly_limit");
  if (c.maxOutputTokens === null) out.push("max_tokens");
  if (c.timeoutMs === null) out.push("timeout");
  return out;
}

/** トークン数から推定費用（円）。単価・為替がなければ 0（モック用） */
export function estimateJpy(c: LlmConfig, inputTokens: number, outputTokens: number): number {
  if (c.priceInUsd === null || c.priceOutUsd === null || c.usdJpy === null) return 0;
  const usd = (inputTokens * c.priceInUsd + outputTokens * c.priceOutUsd) / 1_000_000;
  return Math.round(usd * c.usdJpy * 10000) / 10000;
}

/** 入力の見込みトークン数（保守的に: 1文字を最大1トークン。システムプロンプトを含める。余裕として +50） */
export function conservativeInputTokens(system: string, input: string): number {
  return [...system].length + [...input].length + 50;
}
