/**
 * LLM の利用記録と月次集計の読み書き（SPEC-000b）。利用者の権限では読み書きできない表なので、特権（service_role）で扱う。
 * 本文（入力・応答）は受け取らない・保存しない。
 */
import type { PoolClient } from "pg";
import type { Db } from "../db/pool";
import type { LlmOwner, LlmResult, ReserveInput, ReserveOutcome, FinalizeInput, RejectInput, UsageStore } from "../llm/types";

async function tx<T>(db: Db, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE service_role");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

const ownerCols = (o: LlmOwner) => (o.kind === "system" ? { userId: null, isSystem: true } : { userId: o.userId, isSystem: false });

async function insertRow(
  c: PoolClient,
  i: { owner: LlmOwner; at: Date; promptName: string; mode: string; model: string; result: LlmResult | "pending"; errorKind?: string | null; counted?: boolean; reserved?: number },
): Promise<number> {
  const o = ownerCols(i.owner);
  const r = await c.query(
    `INSERT INTO public.llm_usage (user_id, is_system, created_at, prompt_name, mode, model, result, error_kind, counted, reserved_cost_jpy)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [o.userId, o.isSystem, i.at, i.promptName, i.mode, i.model, i.result, i.errorKind ?? null, i.counted ?? false, i.reserved ?? 0],
  );
  return Number(r.rows[0].id);
}

export function createDbUsageStore(db: Db): UsageStore {
  return {
    /** 1日の回数と月間の残りを確かめ、通れば「呼び出し中」の記録と月間の予約を作る。通らなければ「上限超過」を記録する（同じトランザクション） */
    async reserve(i: ReserveInput): Promise<ReserveOutcome> {
      return tx(db, async (c) => {
        // 月ごと・利用者ごとに直列にする（同時に来ても、合計が上限を超えないように。AC-6）
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`llm_month:${i.month}`]);
        if (i.owner.kind === "user" && i.dailyLimit !== null) {
          const n = await c.query(
            "SELECT count(*)::int AS n FROM public.llm_usage WHERE user_id = $1 AND counted AND created_at >= $2 AND created_at < $3",
            [i.owner.userId, i.dayStart, i.dayEnd],
          );
          if (n.rows[0].n >= i.dailyLimit) {
            await insertRow(c, { ...i, result: "limit_exceeded", errorKind: "daily_limit" });
            return { ok: false, reason: "daily" };
          }
        }
        await c.query("INSERT INTO public.llm_monthly (month) VALUES ($1) ON CONFLICT (month) DO NOTHING", [i.month]);
        if (i.monthlyBudgetJpy !== null) {
          const m = await c.query("SELECT (confirmed_cost_jpy + reserved_cost_jpy)::float8 AS used FROM public.llm_monthly WHERE month = $1", [i.month]);
          if (m.rows[0].used + i.reserveJpy > i.monthlyBudgetJpy) {
            await insertRow(c, { ...i, result: "limit_exceeded", errorKind: "monthly_limit" });
            return { ok: false, reason: "monthly" };
          }
        }
        await c.query("UPDATE public.llm_monthly SET reserved_cost_jpy = reserved_cost_jpy + $2 WHERE month = $1", [i.month, i.reserveJpy]);
        const id = await insertRow(c, { ...i, result: "pending", counted: i.owner.kind === "user", reserved: i.reserveJpy });
        return { ok: true, id };
      });
    },

    /** 呼び出しの結果で確定する。予約を外し、実際の（または見込みの）費用を月次集計に足す */
    async finalize(i: FinalizeInput): Promise<void> {
      await tx(db, async (c) => {
        const r = await c.query("SELECT reserved_cost_jpy::float8 AS reserved, is_system FROM public.llm_usage WHERE id = $1 AND result = 'pending' FOR UPDATE", [i.id]);
        if (!r.rowCount) return;
        const reserved: number = r.rows[0].reserved;
        const counted = !r.rows[0].is_system && (i.result === "success" || i.result === "failure" || i.result === "timeout");
        await c.query(
          `UPDATE public.llm_usage SET result = $2, error_kind = $3, input_tokens = $4, output_tokens = $5,
                  estimated_cost_jpy = $6, reserved_cost_jpy = 0, counted = $7 WHERE id = $1`,
          [i.id, i.result, i.errorKind ?? null, i.inputTokens, i.outputTokens, i.costJpy, counted],
        );
        await c.query(
          `UPDATE public.llm_monthly SET reserved_cost_jpy = greatest(reserved_cost_jpy - $2, 0),
                  confirmed_cost_jpy = confirmed_cost_jpy + $3, provider_calls = provider_calls + $4 WHERE month = $1`,
          [i.month, reserved, i.costJpy, i.sentToProvider ? 1 : 0],
        );
      });
    },

    /** プロバイダを呼ばずに拒否した記録（設定不足など）。回数・月次集計には数えない */
    async reject(i: RejectInput): Promise<void> {
      await tx(db, async (c) => {
        await insertRow(c, { ...i, result: i.result });
      });
    },

    async monthlyRemaining(month: string, budgetJpy: number): Promise<number> {
      return tx(db, async (c) => {
        const m = await c.query("SELECT (confirmed_cost_jpy + reserved_cost_jpy)::float8 AS used FROM public.llm_monthly WHERE month = $1", [month]);
        return budgetJpy - (m.rows[0]?.used ?? 0);
      });
    },
  };
}
