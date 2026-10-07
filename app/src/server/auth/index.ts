import type { AuthProvider } from "./types";
import { supabaseAuthConfig } from "../config";
import { supabaseAuth } from "./supabase";
import { notConfiguredAuth } from "./not-configured";

export * from "./types";

/** 実行時の認証基盤。SUPABASE_URL と SUPABASE_ANON_KEY があれば Supabase、なければ「未設定」 */
export function getAuthProvider(): AuthProvider {
  return supabaseAuthConfig() ? supabaseAuth : notConfiguredAuth;
}
