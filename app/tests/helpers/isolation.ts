/**
 * 分離テストの共通部品（SPEC-000a AC-11）。
 * 個人データのテーブルを1つ追加したら、defineIsolationTests にその表の説明を渡すだけで、
 * 「他人・連携相手・匿名から読めない／変更できない／削除できない／所有者を偽って作れない」テストが付く（AC-9・AC-10 相当）。
 */
import type { Pool } from "pg";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { asAnon, asUser } from "@/server/db/context";
import { createPairForTest } from "@/server/privileged";
import { createAuthUser, createTestDb, type TestDb } from "./db";

export type IsolatedTable = {
  /** 表示名 */
  name: string;
  /** 例: "public.profiles" */
  table: string;
  /** 所有者を示す列 */
  ownerColumn: string;
  /** 行を特定する列（主キーなど） */
  idColumn: string;
  /** 所有者の行を1つ作り、idColumn の値を返す（管理者接続で挿入してよい） */
  seed: (admin: Pool, ownerId: string) => Promise<string>;
  /** 更新を試みる SET 句（例: "display_name = 'hacked'"）と、更新されていないことを確かめる SQL */
  update: { set: string };
  /** 所有者を偽って（owner = 他人）行を作ろうとするときの INSERT 文。$1 に「行を持たない他人」のIDが入る */
  insertForOwnerSql?: string;
  /** 所有者本人が読めるはずの表か（本人も読めない表は false。例: LLM利用記録） */
  ownerCanRead: boolean;
};

type Who = "other" | "partner" | "anon";

async function run<T>(t: TestDb, who: Who, actingUser: string | undefined, fn: (c: import("pg").PoolClient) => Promise<T>): Promise<T> {
  return who === "anon" ? asAnon(t.db, fn) : asUser(t.db, actingUser!, fn);
}

/** 拒否（権限エラー）または 0 件のどちらでも「できなかった」とみなす */
async function deniedOrEmpty(p: Promise<{ rowCount: number | null; rows: unknown[] }>): Promise<number> {
  try {
    const r = await p;
    return r.rowCount ?? r.rows.length;
  } catch (e) {
    expect(String((e as Error).message)).toMatch(/permission denied|row-level security|violates/i);
    return 0;
  }
}

export function defineIsolationTests(spec: IsolatedTable) {
  describe(`分離: ${spec.name}`, () => {
    let t: TestDb;
    let a: string, b: string, victim: string, rowId: string;

    beforeAll(async () => {
      t = await createTestDb();
      a = await createAuthUser(t);
      b = await createAuthUser(t);
      victim = await createAuthUser(t); // 行を持たない他人（所有者を偽った作成の検証用）
      rowId = await spec.seed(t.admin, a);
    });
    afterAll(async () => {
      await t.close();
    });

    const cases: { label: string; who: Who; pairWithA: boolean }[] = [
      { label: "他のユーザーB", who: "other", pairWithA: false },
      { label: "Aと同じ active の pair にいるB（AC-10）", who: "partner", pairWithA: true },
      { label: "未ログイン（匿名）", who: "anon", pairWithA: false },
    ];

    for (const c of cases) {
      describe(c.label, () => {
        let actor: string | undefined;
        beforeAll(async () => {
          if (c.who === "anon") return;
          // 各ケースで別のユーザーを使う（pair は1人1つ）
          actor = c.who === "partner" ? await createAuthUser(t) : b;
          if (c.pairWithA) {
            // A は他のケースで pair に入っていない前提で、A と actor を同じ active の pair に入れる
            await createPairForTest(t.db, [a, actor]);
          }
        });

        it("ID を指定して読めない", async () => {
          const n = await deniedOrEmpty(
            run(t, c.who, actor, (cl) => cl.query(`SELECT * FROM ${spec.table} WHERE ${spec.idColumn} = $1`, [rowId])),
          );
          expect(n).toBe(0);
        });

        it("一覧で、A の行が出ない", async () => {
          const n = await deniedOrEmpty(
            run(t, c.who, actor, (cl) => cl.query(`SELECT * FROM ${spec.table} WHERE ${spec.ownerColumn} = $1`, [a])),
          );
          expect(n).toBe(0);
          const all = await deniedOrEmpty(run(t, c.who, actor, (cl) => cl.query(`SELECT * FROM ${spec.table}`)));
          // B 自身の行はない前提の表なので、全件取得も 0 件
          expect(all).toBe(0);
        });

        it("更新できない（A の行は変わらない）", async () => {
          const before = await t.admin.query(`SELECT * FROM ${spec.table} WHERE ${spec.idColumn} = $1`, [rowId]);
          const n = await deniedOrEmpty(
            run(t, c.who, actor, (cl) => cl.query(`UPDATE ${spec.table} SET ${spec.update.set} WHERE ${spec.idColumn} = $1`, [rowId])),
          );
          expect(n).toBe(0);
          const after = await t.admin.query(`SELECT * FROM ${spec.table} WHERE ${spec.idColumn} = $1`, [rowId]);
          expect(after.rows).toEqual(before.rows);
        });

        it("削除できない（A の行は残る）", async () => {
          const n = await deniedOrEmpty(
            run(t, c.who, actor, (cl) => cl.query(`DELETE FROM ${spec.table} WHERE ${spec.idColumn} = $1`, [rowId])),
          );
          expect(n).toBe(0);
          const still = await t.admin.query(`SELECT 1 FROM ${spec.table} WHERE ${spec.idColumn} = $1`, [rowId]);
          expect(still.rowCount).toBe(1);
        });

        if (spec.insertForOwnerSql) {
          it("他人（行を持たない別のユーザー）を所有者にした行を作れない", async () => {
            const sql = spec.insertForOwnerSql!;
            const before = await t.admin.query(`SELECT count(*)::int AS n FROM ${spec.table}`);
            const n = await deniedOrEmpty(run(t, c.who, actor, (cl) => cl.query(sql, [victim])));
            expect(n).toBe(0);
            const after = await t.admin.query(`SELECT count(*)::int AS n FROM ${spec.table}`);
            expect(after.rows[0].n).toBe(before.rows[0].n);
          });
        }
      });
    }

    it(spec.ownerCanRead ? "（確認）所有者A本人は自分の行を読める" : "（確認）所有者A本人も読めない", async () => {
      const r = await asUser(t.db, a, async (cl) => {
        try {
          return (await cl.query(`SELECT * FROM ${spec.table} WHERE ${spec.idColumn} = $1`, [rowId])).rowCount ?? 0;
        } catch {
          return 0;
        }
      });
      expect(r).toBe(spec.ownerCanRead ? 1 : 0);
    });
  });
}
