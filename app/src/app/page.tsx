import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "@/server/auth";
import { getOwnProfile } from "@/server/db/profile";
import { getDeps } from "@/server/deps";
import { MSG } from "@/server/services/messages";
import { SESSION_COOKIE, resolveSession } from "@/server/session";
import { LogoutButton } from "@/components/LogoutButton";
import { ReloadOnBack } from "@/components/ReloadOnBack";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const sp = await searchParams;
  const jar = await cookies();
  const cookieValue = jar.get(SESSION_COOKIE)?.value;
  if (!cookieValue) redirect("/login");

  const deps = getDeps();
  let session;
  try {
    // ページ（RSC）は cookie を書き換えられない。更新が要るときは /api/auth/refresh に回す（戻ってきた r=1 では再度回さない）
    session = await resolveSession(deps.auth, cookieValue, false);
  } catch (e) {
    if (e instanceof AuthError) return <p className="error">{e.code === "unavailable" ? MSG.network : MSG.unexpected}</p>;
    throw e;
  }
  if (session.state === "none") redirect(sp.r ? "/login" : "/api/auth/refresh");

  const profile = await getOwnProfile(deps.db, session.user.id);
  return (
    <div>
      <ReloadOnBack />
      <h1>CCAI（仮称）</h1>
      {profile?.displayName && <p className="greeting">{profile.displayName} さん</p>}
      <p>相談機能は準備中です。</p>
      <LogoutButton />
    </div>
  );
}
