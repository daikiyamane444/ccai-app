import { AuthError } from "../auth";
import { getOwnProfile } from "../db/profile";
import { deleteAccount, loginUser, registerUser, type Deps } from "../services/account";
import { MSG } from "../services/messages";
import {
  SESSION_COOKIE,
  clearSessionCookieHeader,
  decodeSession,
  readCookie,
  resolveSession,
  sessionCookieHeader,
} from "../session";

export { deleteAccount };

function json(body: unknown, status: number, cookie?: string): Response {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, max-age=0" });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

/** JSON 以外の POST は受けない（他サイトのフォームからの送信を防ぐ。SameSite=Lax と合わせた対策） */
async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().startsWith("application/json")) return json({ error: MSG.badRequest }, 415);
  try {
    const o = await req.json();
    if (o && typeof o === "object" && !Array.isArray(o)) return o as Record<string, unknown>;
  } catch {
    /* fallthrough */
  }
  return json({ error: MSG.badRequest }, 400);
}

export async function handleRegister(req: Request, deps: Deps): Promise<Response> {
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const r = await registerUser(deps, body);
  if (!r.ok) return json({ error: r.message, fieldErrors: r.fieldErrors }, r.status);
  // トークンは本文に出さず HttpOnly の cookie だけで渡す
  return json({ ok: true }, 201, sessionCookieHeader(r.tokens));
}

export async function handleLogin(req: Request, deps: Deps): Promise<Response> {
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const r = await loginUser(deps, body);
  if (!r.ok) return json({ error: r.message }, r.status);
  return json({ ok: true }, 200, sessionCookieHeader(r.tokens));
}

export async function handleLogout(req: Request, deps: Deps): Promise<Response> {
  const tokens = decodeSession(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
  let revoked = true;
  if (tokens) {
    try {
      await deps.auth.signOut(tokens.accessToken);
    } catch (e) {
      // 失効に失敗しても cookie は消す（共有端末で利用者が閉じ込められないように）。種類だけ記録し、トークンは出さない
      revoked = false;
      console.error("logout: session revoke failed", e instanceof AuthError ? e.code : "error");
    }
  }
  return json({ ok: true, revoked }, 200, clearSessionCookieHeader());
}

export async function handleMe(req: Request, deps: Deps): Promise<Response> {
  const cookie = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  let s;
  try {
    s = await resolveSession(deps.auth, cookie);
  } catch (e) {
    if (e instanceof AuthError && e.code === "unavailable") return json({ error: MSG.network }, 503);
    return json({ error: MSG.unexpected }, 500);
  }
  // 未ログイン：データを含まない 401
  if (s.state === "none") return json({ error: MSG.unauthorized }, 401, cookie ? clearSessionCookieHeader() : undefined);
  const profile = await getOwnProfile(deps.db, s.user.id);
  return json({ user: { id: s.user.id, email: s.user.email }, profile: profile ? { displayName: profile.displayName } : null }, 200, s.renewedCookie);
}

/** リフレッシュ用（GET）。成功なら新しい cookie を付けて next へ、失敗なら cookie を消してログインへ */
export async function handleRefresh(req: Request, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  const cookie = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  const to = (path: string, setCookie: string) =>
    new Response(null, { status: 303, headers: { Location: new URL(path, url.origin).toString(), "Set-Cookie": setCookie, "Cache-Control": "no-store, max-age=0" } });
  const tokens = decodeSession(cookie);
  if (!tokens) return to("/login", clearSessionCookieHeader());
  try {
    const r = await deps.auth.refresh(tokens.refreshToken);
    if (!r) return to("/login", clearSessionCookieHeader());
    return to("/?r=1", sessionCookieHeader(r.tokens));
  } catch {
    return to("/login", clearSessionCookieHeader());
  }
}
