// SPEC-000b AC-11: プラン方式のアダプタが Agent SDK に渡す設定（SDK はテスト用に差し替える。外部に通信しない）
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { PlanAdapter, buildPlanOptions, type QueryFn } from "@/server/llm/plan";
import { AdapterError } from "@/server/llm/types";

const req = (signal = new AbortController().signal) => ({ promptName: "_sample", system: "システムの本文", input: "利用者の入力", model: "claude-sonnet-5-5", maxOutputTokens: 800, signal });

function fakeSdk(messages: Record<string, unknown>[]) {
  const seen: { prompt: string; options: Record<string, unknown> }[] = [];
  const q: QueryFn = (p) => {
    seen.push(p);
    return (async function* () {
      for (const m of messages) yield m;
    })();
  };
  return { q, seen };
}

const success = { type: "result", subtype: "success", is_error: false, result: "言い換えた文", total_cost_usd: 0.01, modelUsage: { "claude-sonnet-5-5": { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 5, cacheCreationInputTokens: 0 } } };
const ccaiTmpDirs = () => readdirSync(tmpdir()).filter((n) => n.startsWith("ccai-llm-"));

describe("プラン方式のアダプタ（AC-11）", () => {
  it("ツール無効・設定ファイルを読まない・プロンプトだけ・1往復・記録を保存しない・APIキーを渡さない", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-should-not-pass");
    const o = buildPlanOptions(req(), { cwd: "/tmp/w", configDir: "/tmp/c" }, "oauth-x", new AbortController());
    vi.unstubAllEnvs();
    expect(o.tools).toEqual([]);
    expect(o.allowedTools).toEqual([]);
    expect(o.mcpServers).toEqual({});
    expect(o.strictMcpConfig).toBe(true);
    expect(o.settingSources).toEqual([]);
    expect(o.systemPrompt).toBe("システムの本文");
    expect(o.maxTurns).toBe(1);
    expect(o.persistSession).toBe(false);
    expect(o.cwd).toBe("/tmp/w");
    expect(o.model).toBe("claude-sonnet-5-5");
    // 環境変数は丸ごと置き換え。必要なものだけで、APIキーなどは含めない
    expect(Object.keys(o.env).sort()).toEqual(
      ["CLAUDE_AGENT_SDK_CLIENT_APP", "CLAUDE_CODE_DISABLE_AUTO_MEMORY", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "CLAUDE_CODE_MAX_OUTPUT_TOKENS", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "DISABLE_TELEMETRY", "HOME", "PATH"].sort(),
    );
    expect(o.env.CLAUDE_CONFIG_DIR).toBe("/tmp/c");
    expect(o.env.HOME).toBe("/tmp/c");
    expect(o.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("800");
    expect(JSON.stringify(o.env)).not.toContain("sk-should-not-pass");
  });

  it("SDK には本文だけをプロンプトとして渡し、応答文・トークン数・費用の目安を返す。一時フォルダは呼び出しのたびに消す", async () => {
    const before = ccaiTmpDirs();
    const { q, seen } = fakeSdk([{ type: "assistant", message: {} }, success]);
    const r = await new PlanAdapter("oauth-x", q).generate(req());
    expect(seen.length).toBe(1);
    expect(seen[0].prompt).toBe("利用者の入力");
    expect(r).toEqual({ text: "言い換えた文", inputTokens: 105, outputTokens: 20, providerCostUsd: 0.01 });
    const cwd = seen[0].options.cwd as string;
    expect(existsSync(cwd)).toBe(false);
    expect(ccaiTmpDirs()).toEqual(before);
  });

  it("プラン側の上限・認証・一時的な不調・不明なエラーを種類に直す（本文は含めない）", async () => {
    const cases: [Record<string, unknown>[], string][] = [
      [[{ type: "assistant", error: "rate_limit", message: {} }, { type: "result", subtype: "error_during_execution", is_error: true, errors: ["本文を含むかもしれない"] }], "plan_limit"],
      [[{ type: "assistant", error: "billing_error", message: {} }], "plan_limit"],
      [[{ type: "assistant", error: "authentication_failed", message: {} }], "auth"],
      [[{ type: "assistant", error: "overloaded", message: {} }], "transient"],
      [[{ type: "result", subtype: "error_max_turns", is_error: true, errors: [] }], "unknown"],
      [[], "unknown"],
    ];
    for (const [msgs, kind] of cases) {
      const { q } = fakeSdk(msgs);
      const e = await new PlanAdapter("oauth-x", q).generate(req()).catch((x) => x);
      expect(e).toBeInstanceOf(AdapterError);
      expect(e.kind).toBe(kind);
      expect(String(e.message)).not.toContain("本文");
    }
  });

  it("SDK が例外を投げても、中身を出さずに種類（unknown）にする。中断はタイムアウト", async () => {
    const boom: QueryFn = () =>
      (async function* () {
        throw new Error("SDK internal 利用者の入力 を含む");
      })();
    const e = await new PlanAdapter("oauth-x", boom).generate(req()).catch((x) => x);
    expect(e.kind).toBe("unknown");
    expect(String(e.message)).not.toContain("利用者の入力");
    const ac = new AbortController();
    const slow: QueryFn = (p) =>
      (async function* () {
        await new Promise((r) => setTimeout(r, 50));
        if ((p.options.abortController as AbortController).signal.aborted) throw new Error("aborted");
        yield success;
      })();
    const pending = new PlanAdapter("oauth-x", slow).generate(req(ac.signal));
    ac.abort();
    expect((await pending.catch((x) => x)).kind).toBe("timeout");
  });
});
