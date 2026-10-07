// SPEC-000c AC-5: 登録の限定（許可の一覧にあるメールアドレスだけ。空・未設定なら全部拒否）
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleRegister } from "@/server/handlers";
import { getDeps } from "@/server/deps";
import { parseAllowedEmails } from "@/server/config";
import { MSG } from "@/server/services/messages";
import { createSignupPolicy, envSignupPolicy } from "@/server/services/signup-policy";
import { cookieFrom, get, makeDeps, post, validRegistration } from "./helpers/app";
import { createTestDb, type TestDb } from "./helpers/db";
import { handleMe } from "@/server/handlers";

describe("登録の限定（方針の部品）", () => {
  it("一覧にあるものだけ許す。大文字・小文字と前後の空白は無視する", () => {
    const p = createSignupPolicy(["Owner@Example.test", "  second@example.test "]);
    expect(p.isAllowed("owner@example.test")).toBe(true);
    expect(p.isAllowed("  OWNER@EXAMPLE.TEST  ")).toBe(true);
    expect(p.isAllowed("second@example.test")).toBe(true);
    expect(p.isAllowed("other@example.test")).toBe(false);
    expect(p.isAllowed("owner@example.test.evil")).toBe(false);
    expect(p.isAllowed("xowner@example.test")).toBe(false);
  });
  it("一覧が空なら、何も許さない（fail closed）", () => {
    expect(createSignupPolicy([]).isAllowed("owner@example.test")).toBe(false);
    expect(createSignupPolicy(["", "  "]).isAllowed("")).toBe(false);
  });
  it("環境変数の読み取り: 区切りはカンマ・セミコロン・空白・改行。@のない項目は無視。未設定・空は空の一覧", () => {
    expect(parseAllowedEmails("a@x.test, B@x.test;c@x.test\nd@x.test  e@x.test")).toEqual(["a@x.test", "b@x.test", "c@x.test", "d@x.test", "e@x.test"]);
    expect(parseAllowedEmails("not-an-email, ,")).toEqual([]);
    expect(parseAllowedEmails(undefined)).toEqual([]);
    expect(parseAllowedEmails("")).toEqual([]);
  });
  it("SIGNUP_ALLOWED_EMAILS が未設定のとき、実行時の既定は全部拒否", () => {
    vi.stubEnv("SIGNUP_ALLOWED_EMAILS", "");
    expect(envSignupPolicy().isAllowed("owner@example.test")).toBe(false);
    expect(getDeps().signup.isAllowed("owner@example.test")).toBe(false);
    vi.stubEnv("SIGNUP_ALLOWED_EMAILS", "Owner@Example.test");
    expect(getDeps().signup.isAllowed("owner@example.test")).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("登録の限定（登録API）", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  const body = (email: string) => ({ ...validRegistration, email });

  it("一覧にないアドレスは固定文で拒否され、認証基盤への登録要求が送られず、アカウントもプロフィールもできない", async () => {
    const deps = makeDeps(t, {}, createSignupPolicy(["owner@example.test"]));
    const spy = vi.spyOn(deps.auth, "signUp");
    const res = await handleRegister(post("/api/auth/register", body("stranger@example.test")), deps);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe(MSG.signupClosed);
    expect(json.fieldErrors).toBeUndefined();
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(deps.auth.accountCount()).toBe(0);
    expect((await t.admin.query("SELECT count(*)::int AS n FROM public.profiles")).rows[0].n).toBe(0);
  });

  it("一覧が空・未設定なら、どのアドレスも拒否（認証基盤に送らない）", async () => {
    const deps = makeDeps(t, {}, createSignupPolicy([]));
    const spy = vi.spyOn(deps.auth, "signUp");
    for (const email of ["owner@example.test", "x@example.test"]) {
      const res = await handleRegister(post("/api/auth/register", body(email)), deps);
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe(MSG.signupClosed);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("一覧にあるアドレスは、大文字・小文字や前後の空白が違っても登録でき、ログインした状態になる", async () => {
    const deps = makeDeps(t, {}, createSignupPolicy(["owner@example.test"]));
    const res = await handleRegister(post("/api/auth/register", body("  Owner@Example.TEST ")), deps);
    expect(res.status).toBe(201);
    const cookie = cookieFrom(res)!;
    expect((await handleMe(get("/api/me", cookie), deps)).status).toBe(200);
  });

  it("拒否の応答から、一覧の中身や件数が推測できない（一覧の違いで応答が変わらない。別のアドレスでも同じ）", async () => {
    const lists = [[], ["owner@example.test"], ["owner@example.test", "second@example.test", "third@example.test"]];
    const seen: string[] = [];
    for (const list of lists) {
      const deps = makeDeps(t, {}, createSignupPolicy(list));
      for (const email of ["stranger@example.test", "other@example.test"]) {
        const res = await handleRegister(post("/api/auth/register", body(email)), deps);
        const text = await res.text();
        seen.push(`${res.status}|${text}|${[...res.headers.entries()].filter(([k]) => k !== "date").map(([k, v]) => `${k}=${v}`).sort().join(",")}`);
        for (const e of list) expect(text).not.toContain(e);
      }
    }
    expect(new Set(seen).size).toBe(1);
  });

  it("入力の形式誤り・18歳未満は、これまでどおり先に検査され、その文言が返る", async () => {
    const deps = makeDeps(t, {}, createSignupPolicy([]));
    const bad = await handleRegister(post("/api/auth/register", { ...body("owner@example.test"), ageConfirmed: false }), deps);
    expect(bad.status).toBe(400);
    expect((await bad.json()).fieldErrors.ageConfirmed).toBe(MSG.ageRequired);
  });

  it("許可されたアドレスで二重に登録しても、アカウントは1つ（000a の挙動はそのまま）", async () => {
    const deps = makeDeps(t, {}, createSignupPolicy(["dup@example.test"]));
    const a = await handleRegister(post("/api/auth/register", body("dup@example.test")), deps);
    const b = await handleRegister(post("/api/auth/register", body("dup@example.test")), deps);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });
});
