/**
 * LLM 呼び出しの共通の形（SPEC-000b）。アプリのすべての LLM 呼び出しは gateway.ts の callLlm を通す。
 * 実行方式（モック／プラン方式）の違いはアダプタ（LlmAdapter）の中だけに閉じる。共通の形は app/README.md にも書く。
 */

/** アダプタへの入力 */
export type AdapterRequest = {
  /** プロンプト名（app/prompts/<名前>.md） */
  promptName: string;
  /** システムプロンプト（app/prompts のファイルの本文だけ） */
  system: string;
  /** 本文（利用者の入力。ログ・記録には出さない） */
  input: string;
  /** モデルID */
  model: string;
  maxOutputTokens: number;
  /** タイムアウト・中断の合図 */
  signal: AbortSignal;
};

/** アダプタの出力 */
export type AdapterResponse = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** 実行方式が返す費用の目安（参考。比較のため、記録する費用は単価による推定を正とする） */
  providerCostUsd?: number;
};

/** アダプタのエラーの種類（本文を含めない） */
export type AdapterErrorKind =
  | "timeout" // 時間切れ・中断
  | "transient" // 一時的な不調（再試行してよい）
  | "plan_limit" // プラン側の上限（クレジットの使い切り、利用回数の制限）。再試行しない
  | "auth" // 認証の失敗
  | "invalid" // 要求の誤り（モデル名など）
  | "unknown";

export class AdapterError extends Error {
  constructor(public kind: AdapterErrorKind) {
    super(`llm adapter error: ${kind}`);
    this.name = "AdapterError";
  }
}

export interface LlmAdapter {
  readonly mode: "mock" | "plan";
  generate(req: AdapterRequest): Promise<AdapterResponse>;
}

// ---- 利用記録（privileged/llm-usage.ts と、試走用の memory-store.ts が実装する） ----
export type LlmOwner = { kind: "user"; userId: string } | { kind: "system" };
/** 結果の5種類 */
export type LlmResult = "success" | "failure" | "timeout" | "limit_exceeded" | "config_missing";

type RowBase = { owner: LlmOwner; at: Date; promptName: string; mode: "mock" | "plan"; model: string };

export type ReserveInput = RowBase & {
  month: string;
  dayStart: Date;
  dayEnd: Date;
  /** null なら1日の回数を見ない（システム分、または上限なしのモック） */
  dailyLimit: number | null;
  /** null なら月間を見ない（上限なしのモック） */
  monthlyBudgetJpy: number | null;
  reserveJpy: number;
};
export type ReserveOutcome = { ok: true; id: number } | { ok: false; reason: "daily" | "monthly" };
export type FinalizeInput = {
  id: number;
  month: string;
  result: LlmResult;
  errorKind?: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costJpy: number;
  sentToProvider: boolean;
};
export type RejectInput = RowBase & { result: "config_missing" | "limit_exceeded"; errorKind?: string | null };

export interface UsageStore {
  reserve(i: ReserveInput): Promise<ReserveOutcome>;
  finalize(i: FinalizeInput): Promise<void>;
  reject(i: RejectInput): Promise<void>;
  monthlyRemaining(month: string, budgetJpy: number): Promise<number>;
}
