// SPEC-000b: LLM 呼び出しの共通部分（AC-2, AC-4, AC-5, AC-6, AC-7, AC-8, AC-10, AC-12）。DB は実 Postgres（アプリ用ロールで接続）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { callLlm, isTestRun, LLM_MSG, selectAdapter } from "@/server/llm/gateway";
import { readLlmConfig } from "@/server/llm/config";
import { MockAdapter } from "@/server/llm/mock";
import { PlanAdapter, type QueryFn } from "@/server/llm/plan";
import { loadPrompt, PromptNotFoundError } from "@/server/llm/prompts";
import { jstDayRange, jstMonth } from "@/server/llm/time";
import { createDbUsageStore } from "@/server/privileged/llm-usage";
import { createAuthUser, createTestDb, type TestDb } from "./helpers/db";
import { gatewayDeps } from "./helpers/llm";

const usageRows = (t: TestDb, userId?: string) =>
  t.admin
    .query(
      `SELECT user_id, is_system, prompt_name, mode, model, input_tokens, output_tokens, estimated_cost_jpy::float8 AS cost, result, error_kind, counted
         FROM public.llm_usage ${userId ? "WHERE user_id = $1" : ""} ORDER BY id`,
      userId ? [userId] : [],
    )
    .then((r) => r.rows);
const monthly = (t: TestDb, month: string) =>
  t.admin
    .query("SELECT confirmed_cost_jpy::float8 AS confirmed, reserved_cost_jpy::float8 AS reserved, provider_calls FROM public.llm_monthly WHERE month = $1", [month])
    .then((r) => r.rows[0] ?? { confirmed: 0, reserved: 0, provider_calls: 0 });

describe("SPEC-000b LLM 共通部分", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  const store = () => createDbUsageStore(t.db);

  describe("AC-2 自動テストではモック", () => {
    it("設定がプラン方式でも、自動テストの実行中はモックが選ばれる（外部に通信しない）", () => {
      expect(isTestRun()).toBe(true);
      const c = readLlmConfig((n) => ({ LLM_MODE: "plan", CLAUDE_CODE_OAUTH_TOKEN: "x" })[n]);
      expect(c.mode).toBe("plan");
      expect(selectAdapter(c).mode).toBe("mock");
    });
    it("外部通信を遮断しても動き、プロンプト名ごとの固定応答を返す", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
        throw new Error("network blocked in test");
      });
      const u = await createAuthUser(t);
      const r = await callLlm(gatewayDeps(store()), { owner: { kind: "user", userId: u }, promptName: "_sample", input: "テスト" });
      fetchSpy.mockRestore();
      expect(r.ok && r.text).toBe("（モックの応答）受け取った文を短く言い換えました。");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("AC-12 プロンプトの読み込み", () => {
    it("app/prompts のファイルから名前で読み、先頭に SPEC 番号・目的・版がある", async () => {
      const p = await loadPrompt("_sample");
      expect(p.spec).toBe("SPEC-000b");
      expect(p.version).toBe("1");
      expect(p.purpose.length).toBeGreaterThan(0);
      expect(p.system).toMatch(/言い換え/);
      expect(readFileSync(join(process.cwd(), "prompts/README.md"), "utf8")).toMatch(/1ファイル1プロンプト/);
    });
    it("存在しない名前・不正な名前は、プロバイダを呼ばずにエラー（設定不足として記録）", async () => {
      await expect(loadPrompt("no-such")).rejects.toBeInstanceOf(PromptNotFoundError);
      await expect(loadPrompt("../etc/passwd")).rejects.toBeInstanceOf(PromptNotFoundError);
      const u = await createAuthUser(t);
      const adapter = new MockAdapter();
      for (const name of ["no-such", "../secret"]) {
        const r = await callLlm(gatewayDeps(store(), { adapter }), { owner: { kind: "user", userId: u }, promptName: name, input: "x" });
        expect(r.ok).toBe(false);
        expect(!r.ok && r.errorKind).toBe("unknown_prompt");
      }
      expect(adapter.calls).toBe(0);
      expect((await usageRows(t, u)).map((x) => [x.result, x.prompt_name])).toEqual([
        ["config_missing", "no-such"],
        ["config_missing", "(invalid)"],
      ]);
    });
  });

  describe("AC-4 上限と設定不足", () => {
    it("1日の回数上限に達したら、モックを呼ばずに上限超過", async () => {
      const u = await createAuthUser(t);
      const adapter = new MockAdapter();
      const deps = gatewayDeps(store(), { adapter, config: { dailyCallLimit: 2 } });
      const call = () => callLlm(deps, { owner: { kind: "user", userId: u }, promptName: "_sample", input: "a" });
      expect((await call()).ok).toBe(true);
      expect((await call()).ok).toBe(true);
      const r = await call();
      expect(r.ok).toBe(false);
      expect(!r.ok && [r.result, r.errorKind, r.message]).toEqual(["limit_exceeded", "daily_limit", LLM_MSG.limit]);
      expect(adapter.calls).toBe(2);
    });
    it("月間上限に達したら、モックを呼ばずに上限超過", async () => {
      const u = await createAuthUser(t);
      // 1回の実費: (1000×2$ + 800×10$)/100万 × 150円 = 1.5円。予約の見込みは約1.3円。上限2円なら2回目は予約の時点で超える
      const adapter = new MockAdapter({ _sample: { inputTokens: 1000, outputTokens: 800 } });
      const deps = gatewayDeps(store(), { adapter, config: { monthlyBudgetJpy: 2 }, now: () => new Date("2031-01-15T03:00:00Z") });
      const r1 = await callLlm(deps, { owner: { kind: "user", userId: u }, promptName: "_sample", input: "a" });
      const r2 = await callLlm(deps, { owner: { kind: "user", userId: u }, promptName: "_sample", input: "a" });
      expect(r1.ok).toBe(true);
      expect(!r2.ok && [r2.result, r2.errorKind, r2.message]).toEqual(["limit_exceeded", "monthly_limit", LLM_MSG.limit]);
      expect(adapter.calls).toBe(1);
      expect((await monthly(t, "2031-01")).confirmed).toBeCloseTo(1.5, 4);
    });

    const planWithFakeSdk = () => {
      const q = vi.fn<QueryFn>();
      return { adapter: new PlanAdapter("dummy", q), q };
    };
    const cases: [string, Record<string, unknown>, string][] = [
      ["上限の設定がない", { dailyCallLimit: null }, "daily_limit"],
      ["月間上限が不正", { monthlyBudgetJpy: null }, "monthly_limit"],
      ["単価が未設定のモデル", { priceInUsd: null }, "price"],
      ["為替が未設定", { usdJpy: null }, "fx"],
      ["認証情報がない", { hasPlanCredential: false }, "credential"],
    ];
    for (const [label, over, kind] of cases) {
      it(`プラン方式で${label}なら、実プロバイダを呼ばずに設定不足`, async () => {
        const u = await createAuthUser(t);
        const { adapter, q } = planWithFakeSdk();
        const r = await callLlm(gatewayDeps(store(), { adapter, config: { mode: "plan", hasPlanCredential: true, ...over } }), {
          owner: { kind: "user", userId: u },
          promptName: "_sample",
          input: "a",
        });
        expect(!r.ok && [r.result, r.errorKind]).toEqual(["config_missing", kind]);
        expect(q).not.toHaveBeenCalled();
        expect((await usageRows(t, u)).map((x) => x.result)).toEqual(["config_missing"]);
      });
    }
    it("不正な値の環境変数は未設定と同じ扱い（数字以外・0・範囲外）", () => {
      const c = readLlmConfig((n) => ({ LLM_DAILY_CALL_LIMIT: "abc", LLM_MONTHLY_BUDGET_JPY: "0", LLM_MAX_OUTPUT_TOKENS: "-1", LLM_TIMEOUT_MS: "1e9", LLM_USD_JPY: "150" })[n]);
      expect([c.dailyCallLimit, c.monthlyBudgetJpy, c.maxOutputTokens, c.timeoutMs, c.usdJpy]).toEqual([null, null, null, null, 150]);
    });
    it("公開環境（Vercel）ではプラン方式を使わない（設定不足）", async () => {
      vi.stubEnv("VERCEL", "1");
      const u = await createAuthUser(t);
      const { adapter, q } = planWithFakeSdk();
      const r = await callLlm(gatewayDeps(store(), { adapter, config: { mode: "plan", hasPlanCredential: true } }), { owner: { kind: "user", userId: u }, promptName: "_sample", input: "a" });
      vi.unstubAllEnvs();
      expect(!r.ok && r.errorKind).toBe("deployed_runtime");
      expect(q).not.toHaveBeenCalled();
    });
  });

  describe("AC-5 日本時間の区切り", () => {
    it("区切りの計算（JST 0:00 と毎月1日 0:00）", () => {
      expect(jstDayRange(new Date("2031-03-01T14:59:59Z")).start.toISOString()).toBe("2031-02-28T15:00:00.000Z");
      expect(jstDayRange(new Date("2031-03-01T15:00:00Z")).start.toISOString()).toBe("2031-03-01T15:00:00.000Z");
      expect(jstMonth(new Date("2031-03-31T14:59:59Z"))).toBe("2031-03");
      expect(jstMonth(new Date("2031-03-31T15:00:00Z"))).toBe("2031-04");
    });
    it("日本時間23:59に上限に達した利用者が、0:00以降は再び呼べる", async () => {
      const u = await createAuthUser(t);
      let now = new Date("2031-05-10T14:58:00Z"); // JST 23:58
      const deps = gatewayDeps(store(), { config: { dailyCallLimit: 1 }, now: () => now });
      const call = () => callLlm(deps, { owner: { kind: "user", userId: u }, promptName: "_sample", input: "a" });
      expect((await call()).ok).toBe(true);
      now = new Date("2031-05-10T14:59:30Z"); // JST 23:59:30
      expect((await call()).ok).toBe(false);
      now = new Date("2031-05-10T15:00:00Z"); // JST 0:00
      expect((await call()).ok).toBe(true);
    });
    it("月間の合計は日本時間の月ごと（JST 1日 0:00 で新しい月）", async () => {
      const u = await createAuthUser(t);
      let now = new Date("2031-06-30T14:59:00Z"); // JST 6/30 23:59
      const deps = gatewayDeps(store(), { config: { dailyCallLimit: 100 }, now: () => now });
      await callLlm(deps, { owner: { kind: "user", userId: u }, promptName: "_sample", input: "a" });
      now = new Date("2031-06-30T15:00:00Z"); // JST 7/1 0:00
      await callLlm(deps, { owner: { kind: "user", userId: u }, promptName: "_sample", input: "a" });
      expect((await monthly(t, "2031-06")).provider_calls).toBe(1);
      expect((await monthly(t, "2031-07")).provider_calls).toBe(1);
    });
  });

  describe("AC-6 同時の呼び出しでも月間上限を超えない", () => {
    it("残りが1回分に満たないとき、同時に10件来ても、確定後の合計が上限以下", async () => {
      const users = await Promise.all(Array.from({ length: 10 }, () => createAuthUser(t)));
      const now = () => new Date("2032-02-10T03:00:00Z");
      const adapter = new MockAdapter({ _sample: { delayMs: 50, inputTokens: 1000, outputTokens: 800 } });
      const deps = gatewayDeps(store(), { adapter, config: { monthlyBudgetJpy: 3 }, now });
      const results = await Promise.all(users.map((u) => callLlm(deps, { owner: { kind: "user", userId: u }, promptName: "_sample", input: "a" })));
      const m = await monthly(t, "2032-02");
      expect(m.confirmed + m.reserved).toBeLessThanOrEqual(3);
      expect(m.reserved).toBe(0);
      expect(results.filter((r) => r.ok).length).toBeGreaterThanOrEqual(1);
      expect(results.filter((r) => !r.ok).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("AC-7 1日の回数の数え方", () => {
    it("成功・失敗・タイムアウトは1回、再試行は合わせて1回、拒否は数えない、評価（システム）は数えず月次には入る", async () => {
      const u = await createAuthUser(t);
      const now = () => new Date("2033-03-10T03:00:00Z");
      const adapter = new MockAdapter();
      adapter.enqueue(
        {}, // 成功
        { error: "invalid" }, // 失敗（再試行しない）
        { error: "transient" },
        {}, // 再試行して成功 → 1回
        { error: "timeout" },
        { error: "timeout" }, // 再試行もタイムアウト → 1回
      );
      const deps = gatewayDeps(store(), { adapter, config: { dailyCallLimit: 4 }, now });
      const call = () => callLlm(deps, { owner: { kind: "user", userId: u }, promptName: "_sample", input: "a" });
      const r = [await call(), await call(), await call(), await call()];
      expect(r.map((x) => (x.ok ? "success" : x.result))).toEqual(["success", "failure", "success", "timeout"]);
      expect(adapter.calls).toBe(6);
      const rows = await usageRows(t, u);
      expect(rows.filter((x) => x.counted).length).toBe(4);
      // 5回目は上限超過（数えない）
      const r5 = await call();
      expect(!r5.ok && r5.result).toBe("limit_exceeded");
      // 設定不足も数えない
      await callLlm(deps, { owner: { kind: "user", userId: u }, promptName: "nope", input: "a" });
      const after = await usageRows(t, u);
      expect(after.filter((x) => x.counted).length).toBe(4);
      expect(after.map((x) => x.result)).toEqual(["success", "failure", "success", "timeout", "limit_exceeded", "config_missing"]);
      // システム（評価）は1日の回数の対象外で、月次には入る
      const before = await monthly(t, "2033-03");
      for (let i = 0; i < 6; i++) {
        const s = await callLlm(deps, { owner: { kind: "system" }, promptName: "_sample", input: "a" });
        expect(s.ok).toBe(true);
      }
      const m = await monthly(t, "2033-03");
      expect(m.provider_calls - before.provider_calls).toBe(6);
      const sys = await t.admin.query("SELECT count(*)::int AS n, bool_or(counted) AS any_counted FROM public.llm_usage WHERE is_system AND created_at = $1", [now()]);
      expect(sys.rows[0]).toEqual({ n: 6, any_counted: false });
    });
  });

  describe("AC-8 利用記録", () => {
    it("呼び出しごとに1件、結果は5種類のいずれか、本文の列はない", async () => {
      const u = await createAuthUser(t);
      const adapter = new MockAdapter();
      adapter.enqueue({}, { error: "unknown" }, { error: "timeout" }, { error: "timeout" });
      const deps = gatewayDeps(store(), { adapter, config: { dailyCallLimit: 3 } });
      const call = (p = "_sample") => callLlm(deps, { owner: { kind: "user", userId: u }, promptName: p, input: "a" });
      await call();
      await call();
      await call();
      await call(); // 上限超過
      await call("missing"); // 設定不足
      const rows = await usageRows(t, u);
      expect(rows.map((x) => x.result)).toEqual(["success", "failure", "timeout", "limit_exceeded", "config_missing"]);
      expect(rows[0]).toMatchObject({ is_system: false, prompt_name: "_sample", mode: "mock", model: "claude-sonnet-5-5" });
      expect(rows[0].input_tokens).toBeGreaterThan(0);
      expect(rows[0].output_tokens).toBeGreaterThan(0);
      expect(rows[0].cost).toBeGreaterThan(0);
      const cols = await t.admin.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('llm_usage', 'llm_monthly')");
      for (const c of cols.rows.map((x) => x.column_name as string)) expect(c).not.toMatch(/input_text|output_text|body|content|message|prompt_text|response/);
    });
  });

  describe("AC-10 本文をどこにも出さない", () => {
    it("成功・プロバイダのエラー・タイムアウト・上限超過の4経路で、目印がログ・利用記録・月次集計に現れない", async () => {
      const MARK = "MARKER-本文-7f3a9c";
      const u = await createAuthUser(t);
      const logs: string[] = [];
      const capture = (...a: unknown[]) => void logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
      const spies = (["log", "error", "warn", "info", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(capture));
      const outW = vi.spyOn(process.stdout, "write").mockImplementation((s: string | Uint8Array) => (logs.push(String(s)), true));
      const errW = vi.spyOn(process.stderr, "write").mockImplementation((s: string | Uint8Array) => (logs.push(String(s)), true));
      try {
        const adapter = new MockAdapter();
        adapter.enqueue({ text: `応答 ${MARK}` }, { error: "invalid" }, { error: "timeout" }, { error: "timeout" });
        const deps = gatewayDeps(store(), { adapter, config: { dailyCallLimit: 3 } });
        const call = () => callLlm(deps, { owner: { kind: "user", userId: u }, promptName: "_sample", input: `入力 ${MARK}` });
        const outcomes = [await call(), await call(), await call(), await call()];
        expect(outcomes.map((x) => (x.ok ? "success" : x.result))).toEqual(["success", "failure", "timeout", "limit_exceeded"]);
        for (const o of outcomes.slice(1)) expect(JSON.stringify(o)).not.toContain(MARK);
      } finally {
        for (const s of spies) s.mockRestore();
        outW.mockRestore();
        errW.mockRestore();
      }
      expect(logs.join("\n")).not.toContain(MARK);
      expect(logs.join("\n")).not.toContain("本文");
      const dump = await t.admin.query("SELECT row_to_json(u)::text AS j FROM public.llm_usage u UNION ALL SELECT row_to_json(m)::text FROM public.llm_monthly m");
      expect(dump.rows.map((x) => x.j).join("\n")).not.toContain(MARK);
    });
  });
});
