// SPEC-000b AC-13（試走）・AC-14（実LLMモードの事前確認。SDK はテスト用に差し替え）
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EvalError, parseEvalCases, runEval } from "@/server/llm/eval";
import { MemoryUsageStore } from "@/server/llm/memory-store";
import { MockAdapter } from "@/server/llm/mock";
import { PlanAdapter, type QueryFn } from "@/server/llm/plan";
import { createDbUsageStore } from "@/server/privileged/llm-usage";
import { createTestDb, type TestDb } from "./helpers/db";
import { testConfig } from "./helpers/llm";

const casesFile = resolve(process.cwd(), "../docs/reviews/eval-cases.md");
const outDir = () => mkdtempSync(join(tmpdir(), "ccai-eval-test-"));
const fixedNow = () => new Date("2042-05-06T01:02:00Z"); // JST 2042-05-06 10:02

function fakeSdk() {
  const q = vi.fn<QueryFn>(() =>
    (async function* () {
      yield { type: "result", subtype: "success", is_error: false, result: "実LLM（偽）の応答", total_cost_usd: 0.001, modelUsage: { m: { inputTokens: 120, outputTokens: 30, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } };
    })(),
  );
  return q;
}

describe("評価コマンド", () => {
  it("eval-cases.md の表を読む（EV-01〜）", () => {
    const cases = parseEvalCases(readFileSync(casesFile, "utf8"));
    expect(cases.length).toBeGreaterThanOrEqual(5);
    expect(cases[0]).toMatchObject({ id: "EV-01", aspect: "伝え直し" });
    expect(cases[0].input).not.toMatch(/^「/);
  });

  describe("AC-13 試走（モック）", () => {
    it("認証情報なし・外部通信なしで、結果ファイルを決まった名前で保存する。項目が揃い、設定値・認証情報を含まない", async () => {
      vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "oauth-secret-value-should-not-appear");
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const dir = outDir();
      const log: string[] = [];
      const r = await runEval({ promptName: "_sample", real: false, casesFile, outDir: dir, now: fixedNow, deps: { adapter: new MockAdapter(), store: new MemoryUsageStore(), config: testConfig({ monthlyBudgetJpy: 1234, dailyCallLimit: 77 }), now: fixedNow }, log: (l) => log.push(l) });
      vi.unstubAllEnvs();
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
      expect(r.file).toBe(join(dir, "20420506-1002-_sample.md"));
      const text = readFileSync(r.file, "utf8");
      for (const item of ["実行日時: 2042-05-06T10:02:00.000+09:00", "実行方式: モック", "試走か実LLMか: 試走", "モデル名: claude-sonnet-5-5", "プロンプト: _sample（SPEC-000b、版 1）", "### EV-01", "トークン数: 入力", "推定費用:", "合計:"]) {
        expect(text, item).toContain(item);
      }
      expect(text).toContain("たまには部屋の掃除してほしい");
      for (const secret of ["oauth-secret-value-should-not-appear", "1234", "77", "LLM_", "CLAUDE_CODE", "USD", "為替", "上限"]) expect(text, secret).not.toContain(secret);
      expect(log.join("\n")).toMatch(/評価ケース \d+ 件/);
    });
    it("ケースIDで絞り込める。該当なし・表が読めない・プロンプトがないときは、何も送らずに止まる", async () => {
      const adapter = new MockAdapter();
      const deps = { adapter, store: new MemoryUsageStore(), config: testConfig(), now: fixedNow };
      const dir = outDir();
      const r = await runEval({ promptName: "_sample", real: false, caseIds: ["EV-03", "EV-05"], casesFile, outDir: dir, now: fixedNow, deps });
      const text = readFileSync(r.file, "utf8");
      expect(r.count).toBe(2);
      expect(text).toContain("### EV-03");
      expect(text).toContain("### EV-05");
      expect(text).not.toContain("### EV-01");
      const calls = adapter.calls;
      await expect(runEval({ promptName: "_sample", real: false, caseIds: ["EV-99"], casesFile, outDir: dir, deps })).rejects.toBeInstanceOf(EvalError);
      const empty = join(outDir(), "empty.md");
      writeFileSync(empty, "# 表なし\n");
      await expect(runEval({ promptName: "_sample", real: false, casesFile: empty, outDir: dir, deps })).rejects.toThrow(/表が読めません/);
      await expect(runEval({ promptName: "_sample", real: false, casesFile: join(dir, "nope.md"), outDir: dir, deps })).rejects.toThrow(/読めません/);
      await expect(runEval({ promptName: "nope", real: false, casesFile, outDir: dir, deps })).rejects.toThrow(/プロンプトが見つかりません/);
      expect(adapter.calls).toBe(calls);
    });
  });

  describe("AC-14 実LLMモード（SDK は偽物）", () => {
    let t: TestDb;
    beforeAll(async () => {
      t = await createTestDb();
    });
    afterAll(async () => {
      await t.close();
    });

    it("認証情報がない・単価がないなどのときは、何も送らずに止まる", async () => {
      for (const over of [{ hasPlanCredential: false }, { priceOutUsd: null }, { monthlyBudgetJpy: null }]) {
        const q = fakeSdk();
        const deps = { adapter: new PlanAdapter("", q), store: createDbUsageStore(t.db), config: testConfig({ mode: "plan", hasPlanCredential: true, ...over }), now: fixedNow };
        await expect(runEval({ promptName: "_sample", real: true, casesFile, outDir: outDir(), deps })).rejects.toThrow(/設定が足りません/);
        expect(q).not.toHaveBeenCalled();
      }
      const before = (await t.admin.query("SELECT count(*)::int AS n FROM public.llm_usage")).rows[0].n;
      expect(before).toBe(0);
    });

    it("推定最大消費が今月の残りを超えるなら実行しない", async () => {
      const q = fakeSdk();
      const deps = { adapter: new PlanAdapter("x", q), store: createDbUsageStore(t.db), config: testConfig({ mode: "plan", hasPlanCredential: true, monthlyBudgetJpy: 1 }), now: fixedNow };
      const dir = outDir();
      await expect(runEval({ promptName: "_sample", real: true, casesFile, outDir: dir, now: fixedNow, deps })).rejects.toThrow(/残りを超える/);
      expect(q).not.toHaveBeenCalled();
      expect(readdirSync(dir)).toEqual([]);
    });

    it("開始前に件数と推定最大消費を表示し、実行分は「システム」所有の記録に残り、月次集計に合算される", async () => {
      const q = fakeSdk();
      const deps = { adapter: new PlanAdapter("x", q), store: createDbUsageStore(t.db), config: testConfig({ mode: "plan", hasPlanCredential: true }), now: fixedNow };
      const log: string[] = [];
      const r = await runEval({ promptName: "_sample", real: true, caseIds: ["EV-01", "EV-02"], casesFile, outDir: outDir(), now: fixedNow, deps, log: (l) => log.push(l) });
      expect(log[0]).toMatch(/^評価ケース 2 件、推定最大消費 [0-9.]+ 円（実LLM）$/);
      expect(q).toHaveBeenCalledTimes(2);
      const rows = await t.admin.query("SELECT is_system, user_id, mode, result, counted FROM public.llm_usage WHERE created_at = $1", [fixedNow()]);
      expect(rows.rows).toEqual([
        { is_system: true, user_id: null, mode: "plan", result: "success", counted: false },
        { is_system: true, user_id: null, mode: "plan", result: "success", counted: false },
      ]);
      const m = await t.admin.query("SELECT provider_calls, confirmed_cost_jpy::float8 AS c FROM public.llm_monthly WHERE month = '2042-05'");
      expect(m.rows[0].provider_calls).toBe(2);
      expect(m.rows[0].c).toBeGreaterThan(0);
      const text = readFileSync(r.file, "utf8");
      expect(text).toContain("実行方式: プラン方式（Claude Agent SDK）");
      expect(text).toContain("試走か実LLMか: 実LLM");
      expect(text).toContain("実LLM（偽）の応答");
    });

    it("公開環境では実LLMの評価を実行しない", async () => {
      vi.stubEnv("VERCEL", "1");
      const q = fakeSdk();
      const deps = { adapter: new PlanAdapter("x", q), store: createDbUsageStore(t.db), config: testConfig({ mode: "plan", hasPlanCredential: true }), now: fixedNow };
      await expect(runEval({ promptName: "_sample", real: true, casesFile, outDir: outDir(), deps })).rejects.toThrow(/公開環境/);
      vi.unstubAllEnvs();
      expect(q).not.toHaveBeenCalled();
    });
  });
});
