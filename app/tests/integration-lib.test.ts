// 結合テストの部品（tests/integration/lib.ts）の自己検査。本物の Supabase は使わない。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FORBIDDEN_NAMES, ciEmail, functionRegionFromVercelId, isCiEmail, leakLabels, runIdFromEnv, tablePrivilegeViolations } from "./integration/lib";
import { createTestDb, type TestDb } from "./helpers/db";

describe("テスト用ユーザーのメールアドレス", () => {
  it("決まった形（配信されないドメイン・実行ID・連番）", () => {
    expect(ciEmail("12345", 1)).toBe("ccai-ci+12345-1@example.invalid");
    expect(ciEmail("Run_ABC-9", "b")).toBe("ccai-ci+runabc9-b@example.invalid");
    expect(isCiEmail(ciEmail("987", 3))).toBe(true);
  });
  it("本人や他の利用者のアドレスは、テスト用と見なさない（後片付けで消さない）", () => {
    for (const e of ["owner@example.com", "ccai-ci+1-1@example.com", "xccai-ci+1-1@example.invalid", "ccai-ci+1-1@example.invalid.com", "ccai-ci@example.invalid", "", undefined, null]) {
      expect(isCiEmail(e as string | undefined | null)).toBe(false);
    }
  });
  it("実行ID: 環境変数から。なければ l で始まる値", () => {
    expect(runIdFromEnv({ CI_RUN_ID: "4567" })).toBe("4567");
    expect(runIdFromEnv({})).toMatch(/^l[a-z0-9]+$/);
  });
});

describe("配信物の漏れ検査", () => {
  it("含まれていればラベルだけを返し、値は返さない", () => {
    const hits = leakLabels(["xx top-secret-key-value yy", "other"], { anon: "top-secret-key-value", service: "not-present-value", empty: "", short: "ab" });
    expect(hits).toEqual(["anon"]);
    expect(JSON.stringify(hits)).not.toContain("top-secret-key-value");
  });
  it("禁止する環境変数名に主要なものが入っている", () => {
    for (const n of ["SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "DB_PASSWORD", "SIGNUP_ALLOWED_EMAILS"]) expect(FORBIDDEN_NAMES).toContain(n);
  });
});

describe("Vercel の x-vercel-id", () => {
  it("2番目が関数の実行地域", () => {
    expect(functionRegionFromVercelId("hnd1::hnd1::abc-123")).toBe("hnd1");
    expect(functionRegionFromVercelId("sin1::iad1::abc-123")).toBe("iad1");
    expect(functionRegionFromVercelId("hnd1::abc-123")).toBeUndefined();
    expect(functionRegionFromVercelId(null)).toBeUndefined();
  });
});

describe("テーブル権限の検査SQL（本物の Supabase でも使うものを、ローカルDBで確かめる）", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("マイグレーションどおりなら違反なし", async () => {
    expect(await tablePrivilegeViolations(t.admin)).toEqual([]);
  });

  it("余計な権限を付けると検出される（変異: authenticated に DELETE、anon に SELECT、列単位の UPDATE、新しい表の既定権限）", async () => {
    await t.admin.query("grant delete on public.profiles to authenticated");
    await t.admin.query("grant select on public.pairs to anon");
    await t.admin.query("grant update (age_confirmed_at) on public.profiles to authenticated");
    await t.admin.query("create table public.newtable (id int)"); // shim の既定権限（anon / authenticated に全権限）が付く
    const v = await tablePrivilegeViolations(t.admin);
    expect(v).toContain("authenticated:profiles DELETE");
    expect(v).toContain("anon:pairs SELECT");
    expect(v.some((x) => x.startsWith("authenticated:profiles UPDATE"))).toBe(true);
    expect(v).toContain("anon:newtable SELECT");
    expect(v).toContain("authenticated:newtable INSERT");
  });
});
