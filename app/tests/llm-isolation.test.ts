// SPEC-000b AC-9: LLM 利用記録の分離（000a の共通部品）、月次集計に誰も触れない、全データ削除と月次集計
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser } from "@/server/db/context";
import { createPairForTest, deleteUserData } from "@/server/privileged";
import { callLlm } from "@/server/llm/gateway";
import { createDbUsageStore } from "@/server/privileged/llm-usage";
import { defineIsolationTests } from "./helpers/isolation";
import { createAuthUser, createTestDb, type TestDb } from "./helpers/db";
import { gatewayDeps } from "./helpers/llm";

// 個人データの種類を1つ追加するときの数行（app/README.md「個人データを追加する手順」3）。本人も読めない表なので ownerCanRead: false
defineIsolationTests({
  name: "LLM 利用記録",
  table: "public.llm_usage",
  ownerColumn: "user_id",
  idColumn: "id",
  seed: async (admin, ownerId) =>
    String((await admin.query("INSERT INTO public.llm_usage (user_id, prompt_name, mode, model, result) VALUES ($1, '_sample', 'mock', 'm', 'success') RETURNING id", [ownerId])).rows[0].id),
  update: { set: "model = 'hacked'" },
  insertForOwnerSql: "INSERT INTO public.llm_usage (user_id, prompt_name, mode, model, result) VALUES ($1, '_sample', 'mock', 'm', 'success')",
  ownerCanRead: false,
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? "error";
  }
};

describe("LLM 利用記録・月次集計（AC-9 の残り）", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("本人の権限でも、利用記録を読めず書けない", async () => {
    const a = await createAuthUser(t);
    await t.admin.query("INSERT INTO public.llm_usage (user_id, prompt_name, mode, model, result) VALUES ($1, '_sample', 'mock', 'm', 'success')", [a]);
    for (const sql of [
      "SELECT * FROM public.llm_usage",
      "INSERT INTO public.llm_usage (user_id, prompt_name, mode, model, result) VALUES (auth.uid(), '_sample', 'mock', 'm', 'success')",
      "UPDATE public.llm_usage SET model = 'x'",
      "DELETE FROM public.llm_usage",
    ]) {
      expect(await code(asUser(t.db, a, (c) => c.query(sql))), sql).toBe("42501");
    }
  });

  it("月次集計は、どの利用者（本人・連携相手・匿名）の権限からも読み書きできない", async () => {
    const a = await createAuthUser(t);
    const b = await createAuthUser(t);
    await createPairForTest(t.db, [a, b]);
    await t.admin.query("INSERT INTO public.llm_monthly (month, confirmed_cost_jpy) VALUES ('2040-01', 10) ON CONFLICT DO NOTHING");
    const sqls = ["SELECT * FROM public.llm_monthly", "INSERT INTO public.llm_monthly (month) VALUES ('2040-02')", "UPDATE public.llm_monthly SET confirmed_cost_jpy = 0", "DELETE FROM public.llm_monthly"];
    for (const sql of sqls) {
      expect(await code(asUser(t.db, a, (c) => c.query(sql))), `A: ${sql}`).toBe("42501");
      expect(await code(asUser(t.db, b, (c) => c.query(sql))), `B: ${sql}`).toBe("42501");
      expect(await code(asAnon(t.db, (c) => c.query(sql))), `anon: ${sql}`).toBe("42501");
    }
  });

  it("全データ削除で A の利用記録は消え、B と「システム」の記録は変わらず、月次集計の合計（費用・回数）も変わらない（D-012）", async () => {
    const a = await createAuthUser(t);
    const b = await createAuthUser(t);
    const now = () => new Date("2041-04-10T03:00:00Z");
    const deps = gatewayDeps(createDbUsageStore(t.db), { now });
    for (const owner of [{ kind: "user", userId: a }, { kind: "user", userId: a }, { kind: "user", userId: b }, { kind: "system" }] as const) {
      expect((await callLlm(deps, { owner, promptName: "_sample", input: "x" })).ok).toBe(true);
    }
    const snap = async () => ({
      a: (await t.admin.query("SELECT count(*)::int AS n FROM public.llm_usage WHERE user_id = $1", [a])).rows[0].n,
      b: (await t.admin.query("SELECT row_to_json(u)::text AS j FROM public.llm_usage u WHERE user_id = $1 ORDER BY id", [b])).rows.map((x) => x.j),
      sys: (await t.admin.query("SELECT row_to_json(u)::text AS j FROM public.llm_usage u WHERE is_system ORDER BY id")).rows.map((x) => x.j),
      monthly: (await t.admin.query("SELECT row_to_json(m)::text AS j FROM public.llm_monthly m ORDER BY month")).rows.map((x) => x.j),
    });
    const before = await snap();
    expect(before.a).toBe(2);
    await deleteUserData(t.db, a);
    const after = await snap();
    expect(after.a).toBe(0);
    expect(after.b).toEqual(before.b);
    expect(after.sys).toEqual(before.sys);
    expect(after.monthly).toEqual(before.monthly);
    // 認証側のユーザーを消しても（外部キーの連鎖）、月次集計は変わらない
    await t.admin.query("DELETE FROM auth.users WHERE id = $1", [b]);
    expect((await snap()).monthly).toEqual(before.monthly);
  });
});
