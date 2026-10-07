// AC-12: ユーザー単位の全データ削除（アカウント・プロフィール・pair の所属）。他のユーザーのデータは1件も変わらない
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeAuth } from "@/server/auth/fake";
import { createProfile } from "@/server/db/profile";
import { createPairForTest } from "@/server/privileged";
import { deleteAccount, registerUser } from "@/server/services/account";
import { createAuthUser, createTestDb, insertProfile, type TestDb } from "./helpers/db";

describe("ユーザー単位の全データ削除", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  async function snapshot(userIds: string[]) {
    const prof = await t.admin.query("SELECT * FROM public.profiles WHERE user_id = ANY($1) ORDER BY user_id", [userIds]);
    const mem = await t.admin.query("SELECT * FROM public.pair_members WHERE user_id = ANY($1) ORDER BY pair_id, user_id", [userIds]);
    const pairs = await t.admin.query(
      "SELECT * FROM public.pairs WHERE id IN (SELECT pair_id FROM public.pair_members WHERE user_id = ANY($1)) ORDER BY id",
      [userIds],
    );
    const users = await t.admin.query("SELECT * FROM auth.users WHERE id = ANY($1) ORDER BY id", [userIds]);
    return { prof: prof.rows, mem: mem.rows, pairs: pairs.rows, users: users.rows };
  }

  it("アカウント・プロフィール・pair の所属が消え、他のユーザー（連携相手を含む）のデータは変わらない", async () => {
    const auth = new FakeAuth({ mirror: t.mirror });
    const deps = { auth, db: t.db };
    // 実際の登録の流れでAを作る（認証基盤のアカウント＋プロフィール）
    const reg = await registerUser(deps, { email: "a@example.test", password: "password-a-1", displayName: "A", ageConfirmed: true });
    expect(reg.ok).toBe(true);
    const a = (await t.admin.query("SELECT id FROM auth.users WHERE email = 'a@example.test'")).rows[0].id as string;
    const partner = await createAuthUser(t);
    const other = await createAuthUser(t);
    await insertProfile(t, partner, "相手");
    await insertProfile(t, other, "他人");
    const otherPartner = await createAuthUser(t);
    await createPairForTest(t.db, [a, partner]);
    await createPairForTest(t.db, [other, otherPartner]);

    const before = await snapshot([partner, other, otherPartner]);
    await deleteAccount(deps, a);

    const mine = await snapshot([a]);
    expect(mine.prof).toEqual([]);
    expect(mine.mem).toEqual([]);
    expect(mine.users).toEqual([]);
    expect(auth.hasAccount("a@example.test")).toBe(false);
    // 他のユーザーのデータは1件も変わらない（相手が残る pair の行・相手の所属も含む）
    expect(await snapshot([partner, other, otherPartner])).toEqual(before);
  });

  it("相手がいない pair は、所属を消した結果メンバー0人になったら消える", async () => {
    const auth = new FakeAuth({ mirror: t.mirror });
    const u = await createAuthUser(t);
    const pairId = await createPairForTest(t.db, [u]);
    await deleteAccount({ auth, db: t.db }, u);
    expect((await t.admin.query("SELECT 1 FROM public.pairs WHERE id = $1", [pairId])).rowCount).toBe(0);
  });

  it("認証基盤のアカウント行（auth.users）を消すと、プロフィール・所属がFK制約の連鎖でも消える", async () => {
    const u = await createAuthUser(t);
    const p = await createAuthUser(t);
    await insertProfile(t, u);
    await createPairForTest(t.db, [u, p]);
    await t.admin.query("DELETE FROM auth.users WHERE id = $1", [u]);
    expect((await t.admin.query("SELECT 1 FROM public.profiles WHERE user_id = $1", [u])).rowCount).toBe(0);
    expect((await t.admin.query("SELECT 1 FROM public.pair_members WHERE user_id = $1", [u])).rowCount).toBe(0);
  });

  it("削除は再実行できる（途中で失敗しても続きを消せる）", async () => {
    const auth = new FakeAuth({ mirror: t.mirror });
    const u = await createAuthUser(t);
    await insertProfile(t, u);
    await deleteAccount({ auth, db: t.db }, u);
    await expect(deleteAccount({ auth, db: t.db }, u)).resolves.toBeUndefined();
  });

  it("createProfile は本人の権限で作る（他人のIDでは作れない）", async () => {
    const a = await createAuthUser(t);
    const b = await createAuthUser(t);
    await createProfile(t.db, a, "x");
    await expect(
      // A の権限のまま B のプロフィールを作ろうとする
      (await import("@/server/db/context")).asUser(t.db, a, (c) =>
        c.query("INSERT INTO public.profiles (user_id, age_confirmed_at) VALUES ($1, now())", [b]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
