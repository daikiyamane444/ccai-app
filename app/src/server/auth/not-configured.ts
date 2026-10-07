import { AuthError, type AuthProvider } from "./types";

const fail = async (): Promise<never> => {
  throw new AuthError("not_configured", "認証基盤の接続先が設定されていません");
};

/** SUPABASE_URL などが未設定のとき。画面は表示できるが、登録・ログインはできない（app/README.md） */
export const notConfiguredAuth: AuthProvider = {
  signUp: fail,
  signIn: fail,
  verify: async () => null,
  refresh: async () => null,
  signOut: async () => undefined,
  deleteUser: fail,
};
