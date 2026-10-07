import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, chownSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import type { TestProject } from "vitest/node";
import { readFileSync } from "node:fs";

declare module "vitest" {
  export interface ProvidedContext {
    pgBaseUrl: string;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
    s.on("error", rej);
  });
}

/** root で動いている場合に、Postgres を動かす一般ユーザー（app の祖先ディレクトリのうち root 以外が所有する最初のもの）を決める */
function unprivilegedIds(): { uid: number; gid: number } | undefined {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) return undefined;
  if (process.env.CCAI_TEST_UID) return { uid: Number(process.env.CCAI_TEST_UID), gid: Number(process.env.CCAI_TEST_GID ?? process.env.CCAI_TEST_UID) };
  let dir = appDir;
  for (let i = 0; i < 10; i++) {
    const st = statSync(dir);
    if (st.uid !== 0) return { uid: st.uid, gid: st.gid };
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { uid: 65534, gid: 65534 };
}

async function waitConnect(url: string) {
  for (let i = 0; i < 60; i++) {
    const c = new Client({ connectionString: url });
    try {
      await c.connect();
      await c.end();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error("test postgres did not accept connections");
}

export default async function setup(project: TestProject) {
  const ids = unprivilegedIds();
  const work = mkdtempSync(join(tmpdir(), "ccai-pg-"));
  if (ids) {
    chownSync(work, ids.uid, ids.gid);
    chmodSync(work, 0o700);
  }
  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, [join(here, "db", "pg-server.mjs"), join(work, "data"), String(port)], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: appDir,
    env: { ...process.env, HOME: work },
    ...(ids ? { uid: ids.uid, gid: ids.gid } : {}),
  });
  let stderr = "";
  child.stderr?.on("data", (d) => (stderr += d));
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error("test postgres start timeout\n" + stderr)), 90_000);
    child.stdout?.on("data", (d) => {
      if (String(d).includes("READY")) {
        clearTimeout(t);
        res();
      }
    });
    child.on("exit", (code) => rej(new Error(`test postgres exited (${code})\n${stderr}`)));
  });

  const base = `postgres://postgres:ccai_test@127.0.0.1:${port}`;
  await waitConnect(`${base}/postgres`);

  // テンプレートDB: shim → supabase/migrations の順に適用（マイグレーションのSQLは本番と同じファイルをそのまま使う）
  const admin = new Client({ connectionString: `${base}/postgres` });
  await admin.connect();
  await admin.query("CREATE DATABASE ccai_template");
  await admin.end();
  const t = new Client({ connectionString: `${base}/ccai_template` });
  await t.connect();
  await t.query(readFileSync(join(here, "shim", "supabase-shim.sql"), "utf8"));
  const { readdirSync } = await import("node:fs");
  const migDir = join(appDir, "supabase", "migrations");
  for (const f of readdirSync(migDir).filter((n) => n.endsWith(".sql")).sort()) {
    await t.query(readFileSync(join(migDir, f), "utf8"));
  }
  await t.end();

  project.provide("pgBaseUrl", base);

  return async () => {
    child.stdin?.end();
    await new Promise<void>((res) => {
      const t = setTimeout(() => { child.kill("SIGKILL"); res(); }, 10_000);
      child.on("exit", () => { clearTimeout(t); res(); });
    });
    try { rmSync(work, { recursive: true, force: true }); } catch {}
  };
}
