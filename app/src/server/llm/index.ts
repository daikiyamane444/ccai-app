/**
 * アプリから LLM を呼ぶときの入口（SPEC-001 以降で使う。000b では画面・APIから呼ばない）。
 * 実行方式・上限・利用記録の組み立てをここに集める。
 */
import type { Db } from "../db/pool";
import { createDbUsageStore } from "../privileged/llm-usage";
import { callLlm, defaultGatewayConfig, selectAdapter, type CallInput, type CallOutcome, type GatewayDeps } from "./gateway";

export function getLlmDeps(db: Db): GatewayDeps {
  const config = defaultGatewayConfig();
  return { adapter: selectAdapter(config), store: createDbUsageStore(db), config };
}

export async function callLlmForUser(db: Db, userId: string, promptName: string, input: string): Promise<CallOutcome> {
  const call: CallInput = { owner: { kind: "user", userId }, promptName, input };
  return callLlm(getLlmDeps(db), call);
}

export { LLM_MSG } from "./gateway";
