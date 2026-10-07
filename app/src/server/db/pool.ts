import { Pool } from "pg";
import { databaseUrl } from "../config";

export type Db = { pool: Pool };

export function createDb(connectionString: string): Db {
  return { pool: new Pool({ connectionString, max: 5 }) };
}

let shared: Db | undefined;

/** アプリ実行時の共有接続。DATABASE_URL がなければ ConfigError（接続時に初めて評価する） */
export function getDb(): Db {
  if (!shared) shared = createDb(databaseUrl());
  return shared;
}
