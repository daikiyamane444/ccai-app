// テスト用の Postgres を起動する（npm の embedded-postgres。Docker 不要）。
// 使い方: node pg-server.mjs <dataDir> <port>   標準出力に "READY" を出し、標準入力が閉じるか SIGTERM で停止する。
// PostgreSQL は root では起動できないため、root で実行された場合は呼び出し側（global-setup.ts）が一般ユーザーに降格して起動する。
import EmbeddedPostgres from "embedded-postgres";

const [dataDir, portStr] = process.argv.slice(2);
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "ccai_test",
  port: Number(portStr),
  persistent: false,
  // 本物の Supabase は UTF-8。既定の SQL_ASCII だと char_length が日本語をバイト数で数えてしまう
  initdbFlags: ["--encoding=UTF8", "--locale=C.UTF-8"],
  onLog: () => {},
  onError: (e) => process.stderr.write(String(e) + "\n"),
});

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try { await pg.stop(); } catch {}
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.stdin.on("end", stop);
process.stdin.resume();

await pg.initialise();
await pg.start();
process.stdout.write("READY\n");
