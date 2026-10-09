/**
 * プラン方式のアダプタ（SPEC-000b、D-010）。Claude Agent SDK を、人間が契約中のプランの認証（CLAUDE_CODE_OAUTH_TOKEN）で呼ぶ。
 * Agent SDK を直接使うのは、このファイルだけ（static-checks が確かめる）。
 *
 * 安全のための設定（AC-11）:
 * - ツールはすべて無効（tools: []、allowedTools: []）。外部ツール連携（MCP）も設定しない（mcpServers: {}、strictMcpConfig）
 * - 設定ファイル・指示ファイル（CLAUDE.md など）を読み込まない（settingSources: []、作業フォルダと設定フォルダは空の一時フォルダ）
 * - システムプロンプトは app/prompts の本文だけ（systemPrompt に文字列で渡す）
 * - モデルとのやり取りは1往復（maxTurns: 1）
 * - 会話の記録を手元に保存しない（persistSession: false）。念のため、一時フォルダは呼び出しのたびに削除する
 * - SDK に渡す環境変数は必要なものだけ（env は丸ごと置き換え）。ANTHROPIC_API_KEY などの APIキーは渡さない（従量課金の経路を作らない）
 *
 * 規約（docs/architecture.md 13-2）: プランの認証は、人間本人の開発・評価のためだけに使う。本番（Vercel）では使わない（gateway.ts が拒否する）。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterError, type AdapterErrorKind, type AdapterRequest, type AdapterResponse, type LlmAdapter } from "./types";

/** SDK の query 関数の形（テストで差し替える） */
export type QueryFn = (params: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<Record<string, unknown>>;

async function defaultQuery(): Promise<QueryFn> {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  return sdk.query as unknown as QueryFn;
}

/** SDK に渡す設定を組み立てる（テストで中身を確かめる） */
export function buildPlanOptions(req: AdapterRequest, work: { cwd: string; configDir: string }, credential: string, abortController: AbortController) {
  return {
    model: req.model,
    systemPrompt: req.system,
    tools: [] as string[],
    allowedTools: [] as string[],
    mcpServers: {},
    strictMcpConfig: true,
    settingSources: [] as string[],
    maxTurns: 1,
    persistSession: false,
    cwd: work.cwd,
    abortController,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: work.configDir,
      CLAUDE_CONFIG_DIR: work.configDir,
      CLAUDE_CODE_OAUTH_TOKEN: credential,
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(req.maxOutputTokens),
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      DISABLE_TELEMETRY: "1",
      CLAUDE_AGENT_SDK_CLIENT_APP: "ccai-eval/0.1",
    } as Record<string, string>,
  };
}

const ERROR_MAP: Record<string, AdapterErrorKind> = {
  rate_limit: "plan_limit",
  billing_error: "plan_limit",
  authentication_failed: "auth",
  oauth_org_not_allowed: "auth",
  account_on_hold: "auth",
  verification_required: "auth",
  overloaded: "transient",
  server_error: "transient",
  invalid_request: "invalid",
  model_not_found: "invalid",
};

export class PlanAdapter implements LlmAdapter {
  readonly mode = "plan" as const;
  constructor(
    private credential: string,
    private queryFn?: QueryFn,
  ) {}

  async generate(req: AdapterRequest): Promise<AdapterResponse> {
    const base = await mkdtemp(join(tmpdir(), "ccai-llm-"));
    const work = { cwd: join(base, "work"), configDir: join(base, "config") };
    const { mkdir } = await import("node:fs/promises");
    await mkdir(work.cwd);
    await mkdir(work.configDir);
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    req.signal.addEventListener("abort", onAbort);
    try {
      const q = this.queryFn ?? (await defaultQuery());
      let errorKind: AdapterErrorKind | null = null;
      let result: AdapterResponse | null = null;
      for await (const msg of q({ prompt: req.input, options: buildPlanOptions(req, work, this.credential, ac) })) {
        if (msg.type === "assistant" && typeof msg.error === "string") errorKind = ERROR_MAP[msg.error] ?? "unknown";
        if (msg.type === "result") {
          if (msg.subtype === "success" && msg.is_error !== true && typeof msg.result === "string") {
            const mu = (msg.modelUsage ?? {}) as Record<string, { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number }>;
            let inTok = 0;
            let outTok = 0;
            for (const u of Object.values(mu)) {
              inTok += (u.inputTokens ?? 0) + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0);
              outTok += u.outputTokens ?? 0;
            }
            result = {
              text: msg.result,
              inputTokens: inTok,
              outputTokens: outTok,
              providerCostUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : undefined,
            };
          } else if (!errorKind) {
            errorKind = "unknown";
          }
        }
      }
      if (req.signal.aborted) throw new AdapterError("timeout");
      if (errorKind) throw new AdapterError(errorKind);
      if (!result) throw new AdapterError("unknown");
      return result;
    } catch (e) {
      if (e instanceof AdapterError) throw e;
      // SDK の例外の中身（本文を含みうる）は扱わない。種類だけにする
      throw new AdapterError(req.signal.aborted ? "timeout" : "unknown");
    } finally {
      req.signal.removeEventListener("abort", onAbort);
      await rm(base, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
