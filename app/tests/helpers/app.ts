import { FakeAuth } from "@/server/auth/fake";
import { SESSION_COOKIE } from "@/server/session";
import type { TestDb } from "./db";

export function makeDeps(t: TestDb, opts: ConstructorParameters<typeof FakeAuth>[0] = {}) {
  const auth = new FakeAuth({ mirror: t.mirror, ...opts });
  return { auth, db: t.db };
}

export function post(path: string, body: unknown, cookie?: string, contentType = "application/json"): Request {
  const headers: Record<string, string> = { "Content-Type": contentType };
  if (cookie) headers.cookie = cookie;
  return new Request(`http://localhost${path}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

export function get(path: string, cookie?: string): Request {
  return new Request(`http://localhost${path}`, { method: "GET", headers: cookie ? { cookie } : {} });
}

/** Set-Cookie ヘッダから「name=value」だけを取り出して、次の要求の cookie にする */
export function cookieFrom(res: Response): string | undefined {
  const sc = res.headers.get("set-cookie");
  if (!sc) return undefined;
  const first = sc.split(";")[0];
  return first.startsWith(`${SESSION_COOKIE}=`) && first !== `${SESSION_COOKIE}=` ? first : undefined;
}

export const validRegistration = {
  email: "user@example.test",
  password: "correct-horse-1",
  displayName: "たろう",
  ageConfirmed: true,
};
