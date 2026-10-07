import type { Db } from "./pool";
import { asUser } from "./context";

export type Profile = { userId: string; displayName: string | null; ageConfirmedAt: Date };

export async function createProfile(db: Db, userId: string, displayName: string | null): Promise<void> {
  await asUser(db, userId, (c) =>
    c.query("INSERT INTO public.profiles (user_id, display_name, age_confirmed_at) VALUES ($1, $2, now())", [userId, displayName]),
  );
}

export async function getOwnProfile(db: Db, userId: string): Promise<Profile | null> {
  return asUser(db, userId, async (c) => {
    const r = await c.query("SELECT user_id, display_name, age_confirmed_at FROM public.profiles WHERE user_id = $1", [userId]);
    const row = r.rows[0];
    return row ? { userId: row.user_id, displayName: row.display_name, ageConfirmedAt: row.age_confirmed_at } : null;
  });
}
