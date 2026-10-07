import { getAuthProvider } from "./auth";
import { getDb } from "./db/pool";
import type { Deps } from "./services/account";

/** 実行時の依存（認証基盤とDB）。Deps の中身は呼び出し時に評価する（ビルド時に環境変数がなくても読み込める） */
export function getDeps(): Deps {
  return {
    auth: getAuthProvider(),
    get db() {
      return getDb();
    },
  } as Deps;
}
