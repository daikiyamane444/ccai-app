import { Pool } from "pg";
import { buildDatabaseConnection, type DbConnection } from "../config";

export type Db = { pool: Pool };

export function createDb(connection: string | DbConnection): Db {
  const c = typeof connection === "string" ? { connectionString: connection } : connection;
  return { pool: new Pool({ ...c, max: 5 }) };
}

let shared: Db | undefined;

/** アプリ実行時の共有接続。接続情報がなければ ConfigError（接続時に初めて評価する） */
export function getDb(): Db {
  if (!shared) shared = createDb(buildDatabaseConnection());
  return shared;
}
