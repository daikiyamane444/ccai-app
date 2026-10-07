// AC-13: pair の制約（メンバー最大2人、1人が同時に所属できる active は1つ、状態は active / ended のみ）がデータ層で守られる
// ＋ pair の読み取りは当事者だけ（AC-10 の補足）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser } from "@/server/db/context";
import { createPairForTest } from "@/server/privileged";
import { createAuthUser, createTestDb, type TestDb } from "./helpers/db";

describe("pair の制約（データ層）", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  async function newPair(status: "active" | "ended" = "active"): Promise<string> {
    return (await t.admin.query("INSERT INTO public.pairs (status) VALUES ($1) RETURNING id", [status])).rows[0].id;
  }
  const addMember = (pairId: string, userId: string) =>
    t.admin.query("INSERT INTO public.pair_members (pair_id, user_id) VALUES ($1, $2)", [pairId, userId]);

  it("2人までは登録でき、3人目は拒否される", async () => {
    const [u1, u2, u3] = [await createAuthUser(t), await createAuthUser(t), await createAuthUser(t)];
    const p = await newPair();
    await addMember(p, u1);
    await addMember(p, u2);
    await expect(addMember(p, u3)).rejects.toThrow(/pair_full/);
    expect((await t.admin.query("SELECT count(*)::int AS n FROM public.pair_members WHERE pair_id = $1", [p])).rows[0].n).toBe(2);
  });

  it("同時に3人目・4人目が登録されても、2人を超えない", async () => {
    const users = await Promise.all([1, 2, 3, 4].map(() => createAuthUser(t)));
    const p = await newPair();
    const results = await Promise.allSettled(users.map((u) => addMember(p, u)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect((await t.admin.query("SELECT count(*)::int AS n FROM public.pair_members WHERE pair_id = $1", [p])).rows[0].n).toBe(2);
  });

  it("1人が同時に所属できる active の pair は1つ（2つ目は拒否）", async () => {
    const [u1, u2, u3] = [await createAuthUser(t), await createAuthUser(t), await createAuthUser(t)];
    await createPairForTest(t.db, [u1, u2]);
    const p2 = await newPair();
    await expect(addMember(p2, u1)).rejects.toThrow(/user_already_in_active_pair/);
    await addMember(p2, u3); // 別の人は入れる
  });

  it("同時に同じ人が別々の active pair に登録されても、1つしか通らない", async () => {
    const u = await createAuthUser(t);
    const [p1, p2, p3] = [await newPair(), await newPair(), await newPair()];
    const results = await Promise.allSettled([addMember(p1, u), addMember(p2, u), addMember(p3, u)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("ended の pair には所属していても、新しい active に入れる", async () => {
    const [u1, u2, u3] = [await createAuthUser(t), await createAuthUser(t), await createAuthUser(t)];
    await createPairForTest(t.db, [u1, u2], "ended");
    await createPairForTest(t.db, [u1, u3], "active");
    expect((await t.admin.query("SELECT count(*)::int AS n FROM public.pair_members WHERE user_id = $1", [u1])).rows[0].n).toBe(2);
  });

  it("ended を active に戻すとき、メンバーが他の active に入っていれば拒否される", async () => {
    const [u1, u2, u3] = [await createAuthUser(t), await createAuthUser(t), await createAuthUser(t)];
    const ended = await createPairForTest(t.db, [u1, u2], "ended");
    await createPairForTest(t.db, [u1, u3], "active");
    await expect(t.admin.query("UPDATE public.pairs SET status = 'active' WHERE id = $1", [ended])).rejects.toThrow(/user_already_in_active_pair/);
  });

  it("状態は active / ended のみ", async () => {
    await expect(t.admin.query("INSERT INTO public.pairs (status) VALUES ('pending')")).rejects.toThrow(/check/);
  });

  it("所属の付け替え（UPDATE）はできない", async () => {
    const [u1, u2] = [await createAuthUser(t), await createAuthUser(t)];
    const p = await createPairForTest(t.db, [u1]);
    await expect(t.admin.query("UPDATE public.pair_members SET user_id = $1 WHERE pair_id = $2", [u2, p])).rejects.toThrow(/immutable/);
  });

  it("特権の処理（テスト用の作成手段）でも制約は破れない", async () => {
    const [u1, u2, u3] = [await createAuthUser(t), await createAuthUser(t), await createAuthUser(t)];
    await expect(createPairForTest(t.db, [u1, u2, u3])).rejects.toThrow(/pair_full/);
  });

  it("利用者は自分が所属する pair だけを読める。作成・更新・削除はできない。匿名は読めない", async () => {
    const [u1, u2, u3] = [await createAuthUser(t), await createAuthUser(t), await createAuthUser(t)];
    const p = await createPairForTest(t.db, [u1, u2]);
    expect((await asUser(t.db, u1, (c) => c.query("SELECT id FROM public.pairs WHERE id = $1", [p]))).rowCount).toBe(1);
    expect((await asUser(t.db, u1, (c) => c.query("SELECT user_id FROM public.pair_members WHERE pair_id = $1", [p]))).rows).toEqual([{ user_id: u1 }]);
    expect((await asUser(t.db, u3, (c) => c.query("SELECT id FROM public.pairs WHERE id = $1", [p]))).rowCount).toBe(0);
    await expect(asUser(t.db, u1, (c) => c.query("UPDATE public.pairs SET status = 'ended' WHERE id = $1", [p]))).rejects.toThrow(/permission denied/);
    await expect(asUser(t.db, u1, (c) => c.query("DELETE FROM public.pair_members WHERE pair_id = $1", [p]))).rejects.toThrow(/permission denied/);
    await expect(asUser(t.db, u1, (c) => c.query("INSERT INTO public.pair_members (pair_id, user_id) VALUES ($1, $2)", [p, u3]))).rejects.toThrow(/permission denied/);
    await expect(asAnon(t.db, (c) => c.query("SELECT id FROM public.pairs"))).rejects.toThrow(/permission denied/);
  });
});
