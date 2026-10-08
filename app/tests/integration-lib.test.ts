// 結合テストの部品（tests/integration/lib.ts）の自己検査。本物の Supabase は使わない。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FORBIDDEN_NAMES, ciEmail, functionRegionFromVercelId, isCiEmail, leakLabels, runIdFromEnv, tablePrivilegeViolations } from "./integration/lib";
import { createTestDb, type TestDb } from "./helpers/db";

describe("テスト用ユーザーのメールアドレス", () => {
  it("決まった形（配信されないドメイン・実行ID・連番）", () => {
    expect(ciEmail("12345", 1)).toBe("ccai-ci+12345-1@example.invalid");
    expect(ciEmail("Run_ABC-9", "b")).toBe("ccai-ci+runabc9-b@example.invalid");
    expect(ciEmail("12345", "Site-Login")).toBe("ccai-ci+12345-sitelogin@example.invalid");
    expect(isCiEmail(ciEmail("987", 3))).toBe(true);
  });
  it("本人や他の利用者のアドレスは、テスト用と見なさない（後片付けで消さない）", () => {
    for (const e of ["owner@example.com", "ccai-ci+1-1@example.com", "xccai-ci+1-1@example.invalid", "ccai-ci+1-1@example.invalid.com", "ccai-ci@example.invalid", "", undefined, null]) {
      expect(isCiEmail(e as string | undefined | null)).toBe(false);
    }
  });
  it("名前に「-」などが入っても、作るアドレスは必ず後片付けの判定に一致する（初回実行の取り残しの原因）", () => {
    for (const n of ["setlocal-a", "rest-a", "del-c", "site-login", "site-register", "A B_c.d", 7]) {
      const e = ciEmail("37705052038", n);
      expect(isCiEmail(e), String(n)).toBe(true);
      expect(e.split("@")[0].split("-").length).toBe(3); // ccai / ci+<実行ID> / <名前>
    }
    expect(() => ciEmail("1", "---")).toThrow();
  });
  it("初回実行で残った形（名前に「-」を含む）も、後片付けの対象になる", () => {
    for (const e of ["ccai-ci+37705052038-setlocal-a@example.invalid", "ccai-ci+37705052038-rest-b@example.invalid", "ccai-ci+37705052038-site-login@example.invalid"]) {
      expect(isCiEmail(e)).toBe(true);
    }
    for (const e of ["ccai-ci+1-@example.invalid", "ccai-ci+1--a@example.invalid", "ccai-ci+1-a-@example.invalid", "ccai-ci+-a@example.invalid"]) expect(isCiEmail(e), e).toBe(false);
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

describe("値を出さない確かめ方（lib.ts）", () => {
  it("失敗時のメッセージに、渡した値（トークンなど）が出ない", async () => {
    const { ok, sameCode } = await import("./integration/lib");
    const secret: string = "refresh-token-SECRET-123456";
    const messageOf = (fn: () => void) => {
      try {
        fn();
        return "";
      } catch (e) {
        return String((e as Error).message) + JSON.stringify(e);
      }
    };
    const m1 = messageOf(() => ok(secret === "x", "更新は拒否される"));
    expect(m1).toContain("更新は拒否される");
    expect(m1).not.toContain(secret);
    const m2 = messageOf(() => sameCode(secret, "auth:invalid_token", "コード"));
    expect(m2).not.toContain(secret);
    expect(m2).toContain("(非表示)");
    const m3 = messageOf(() => sameCode("auth:unexpected", "auth:invalid_token", "コード"));
    expect(m3).toContain("auth:unexpected");
  });
});

describe("結合テストの出力の伏せ字（scripts/run-integration.mjs）", () => {
  it("伏せ字の対象（環境変数の値・テスト用パスワード・JWT・キーの形・メールアドレス・名前つきのトークン）を伏せる", async () => {
    // @ts-expect-error 型定義のない .mjs
    const { redactLine, secretValues } = await import("../scripts/run-integration.mjs");
    const env = {
      SUPABASE_URL: "https://abcdefghijkl.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-key-value-0001",
      DB_PASSWORD: "dbpass-value-0002",
      CI_TEST_PASSWORD: "Ci-testpw-0003",
    };
    const values = secretValues(env);
    const line =
      "x service-key-value-0001 dbpass-value-0002 Ci-testpw-0003 abcdefghijkl eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop owner@example.com ccai-ci+1-a@example.invalid refresh_token: \"r7x9k2m4p1q8\" sb_secret_abcdefgh123";
    const out = redactLine(line, values);
    for (const v of ["service-key-value-0001", "dbpass-value-0002", "Ci-testpw-0003", "abcdefghijkl", "eyJhbGci", "owner@example.com", "ccai-ci+1-a", "r7x9k2m4p1q8", "sb_secret_abcdefgh123"]) {
      expect(out, v).not.toContain(v);
    }
    expect(redactLine("Tests  3 passed (3)", values)).toBe("Tests  3 passed (3)");
    // 範囲の限界（文書どおり）: 名前なしで出たリフレッシュトークンは伏せられない。だから書き方の規則（static-checks）で出さない
    expect(redactLine("value r7x9k2m4p1q8", values)).toContain("r7x9k2m4p1q8");
  });
});
