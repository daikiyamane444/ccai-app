import { readLlmConfig, type LlmConfig } from "@/server/llm/config";
import { MockAdapter } from "@/server/llm/mock";
import type { GatewayDeps } from "@/server/llm/gateway";
import type { LlmAdapter, UsageStore } from "@/server/llm/types";

/** テスト用の設定（上限・単価・為替をすべて入れたもの。変えたい項目だけ上書きする） */
export function testConfig(over: Partial<LlmConfig> = {}): LlmConfig {
  const env: Record<string, string> = {
    LLM_PRICE_PRIMARY_INPUT_USD: "2",
    LLM_PRICE_PRIMARY_OUTPUT_USD: "10",
    LLM_USD_JPY: "150",
    LLM_DAILY_CALL_LIMIT: "30",
    LLM_MONTHLY_BUDGET_JPY: "3000",
    LLM_MAX_OUTPUT_TOKENS: "800",
    LLM_TIMEOUT_MS: "30000",
  };
  return { ...readLlmConfig((n) => env[n]), ...over };
}

export function gatewayDeps(store: UsageStore, opts: { adapter?: LlmAdapter; config?: Partial<LlmConfig>; now?: () => Date } = {}): GatewayDeps & { adapter: LlmAdapter } {
  return { adapter: opts.adapter ?? new MockAdapter(), store, config: testConfig(opts.config), now: opts.now, retryDelayMs: 0 };
}
