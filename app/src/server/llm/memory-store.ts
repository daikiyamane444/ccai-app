/**
 * 試走（モック）の評価コマンド用の、メモリ上の利用記録。DB に接続しない。仕組みは DB 版（privileged/llm-usage.ts）と同じ。
 */
import type { FinalizeInput, RejectInput, ReserveInput, ReserveOutcome, UsageStore } from "./types";

export type MemoryRow = { id: number; ownerKey: string; at: Date; result: string; counted: boolean; reserved: number; cost: number; errorKind: string | null; inputTokens: number | null; outputTokens: number | null };

export class MemoryUsageStore implements UsageStore {
  rows: MemoryRow[] = [];
  monthly = new Map<string, { confirmed: number; reserved: number; calls: number }>();
  private seq = 0;

  private m(month: string) {
    let v = this.monthly.get(month);
    if (!v) this.monthly.set(month, (v = { confirmed: 0, reserved: 0, calls: 0 }));
    return v;
  }

  async reserve(i: ReserveInput): Promise<ReserveOutcome> {
    const ownerKey = i.owner.kind === "system" ? "system" : i.owner.userId;
    const push = (result: string, errorKind: string | null, counted: boolean, reserved: number) => {
      const row = { id: ++this.seq, ownerKey, at: i.at, result, counted, reserved, cost: 0, errorKind, inputTokens: null, outputTokens: null };
      this.rows.push(row);
      return row.id;
    };
    if (i.owner.kind === "user" && i.dailyLimit !== null) {
      const n = this.rows.filter((r) => r.ownerKey === ownerKey && r.counted && r.at >= i.dayStart && r.at < i.dayEnd).length;
      if (n >= i.dailyLimit) {
        push("limit_exceeded", "daily_limit", false, 0);
        return { ok: false, reason: "daily" };
      }
    }
    const m = this.m(i.month);
    if (i.monthlyBudgetJpy !== null && m.confirmed + m.reserved + i.reserveJpy > i.monthlyBudgetJpy) {
      push("limit_exceeded", "monthly_limit", false, 0);
      return { ok: false, reason: "monthly" };
    }
    m.reserved += i.reserveJpy;
    return { ok: true, id: push("pending", null, i.owner.kind === "user", i.reserveJpy) };
  }

  async finalize(i: FinalizeInput): Promise<void> {
    const row = this.rows.find((r) => r.id === i.id && r.result === "pending");
    if (!row) return;
    const m = this.m(i.month);
    m.reserved = Math.max(0, m.reserved - row.reserved);
    m.confirmed += i.costJpy;
    if (i.sentToProvider) m.calls += 1;
    Object.assign(row, {
      result: i.result,
      errorKind: i.errorKind ?? null,
      reserved: 0,
      cost: i.costJpy,
      inputTokens: i.inputTokens,
      outputTokens: i.outputTokens,
      counted: row.ownerKey !== "system" && ["success", "failure", "timeout"].includes(i.result),
    });
  }

  async reject(i: RejectInput): Promise<void> {
    this.rows.push({ id: ++this.seq, ownerKey: i.owner.kind === "system" ? "system" : i.owner.userId, at: i.at, result: i.result, counted: false, reserved: 0, cost: 0, errorKind: i.errorKind ?? null, inputTokens: null, outputTokens: null });
  }

  async monthlyRemaining(month: string, budgetJpy: number): Promise<number> {
    const m = this.m(month);
    return budgetJpy - m.confirmed - m.reserved;
  }
}
