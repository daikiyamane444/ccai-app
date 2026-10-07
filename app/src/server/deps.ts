import { getAuthProvider } from "./auth";
import { getDb } from "./db/pool";
import { envSignupPolicy } from "./services/signup-policy";
import type { Deps } from "./services/account";

/** 実行時の依存（認証基盤とDB）。Deps の中身は呼び出し時に評価する（ビルド時に環境変数がなくても読み込める） */
export function getDeps(): Deps {
  return {
    auth: getAuthProvider(),
    signup: envSignupPolicy(),
    get db() {
      return getDb();
    },
  } as Deps;
}
