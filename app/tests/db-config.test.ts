// SPEC-000c: DB 接続情報の組み立て（人間が貼り付ける部品から接続文字列を作る）
import { describe, expect, it } from "vitest";
import { buildDatabaseConnection, ConfigError } from "@/server/config";

const env = (o: Record<string, string>) => (n: string) => o[n] || undefined;

describe("buildDatabaseConnection", () => {
  it("DATABASE_URL があればそのまま使う（暗号化は DB_SSL=require のときだけ）", () => {
    expect(buildDatabaseConnection(env({ DATABASE_URL: "postgres://u:p@127.0.0.1:5432/d" }))).toEqual({ connectionString: "postgres://u:p@127.0.0.1:5432/d" });
    expect(buildDatabaseConnection(env({ DATABASE_URL: "postgres://u:p@h:5432/d", DB_SSL: "require" })).ssl).toBeTruthy();
  });

  it("Supabase のプーラー: ユーザー名に .<プロジェクトID> を自動で付け、既定は ccai_app・ポート6543・postgres・暗号化あり", () => {
    const c = buildDatabaseConnection(
      env({ DB_HOST: "aws-0-ap-northeast-1.pooler.supabase.com", DB_PASSWORD: "pw", SUPABASE_URL: "https://abcdefgh.supabase.co" }),
    );
    expect(c.connectionString).toBe("postgres://ccai_app.abcdefgh:pw@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres");
    expect(c.ssl).toBeTruthy();
  });

  it("パスワードの記号はエンコードされる（人間が組み立てなくてよい）", () => {
    const c = buildDatabaseConnection(env({ DB_HOST: "db.example.test", DB_PASSWORD: "p@ss:w/o#rd?", DB_USER: "ccai_app" }));
    expect(c.connectionString).toBe(`postgres://ccai_app:${encodeURIComponent("p@ss:w/o#rd?")}@db.example.test:5432/postgres`);
    expect(new URL(c.connectionString).password).toBe(encodeURIComponent("p@ss:w/o#rd?"));
  });

  it("ローカルのホストは暗号化なし。DB_SSL で切り替えられる", () => {
    expect(buildDatabaseConnection(env({ DB_HOST: "127.0.0.1", DB_PASSWORD: "pw" })).ssl).toBeUndefined();
    expect(buildDatabaseConnection(env({ DB_HOST: "127.0.0.1", DB_PASSWORD: "pw", DB_SSL: "require" })).ssl).toBeTruthy();
    expect(buildDatabaseConnection(env({ DB_HOST: "db.example.test", DB_PASSWORD: "pw", DB_SSL: "disable" })).ssl).toBeUndefined();
  });

  it("ユーザー名にすでに . があればそのまま。ポート・DB名の指定が効く", () => {
    const c = buildDatabaseConnection(
      env({ DB_HOST: "x.pooler.supabase.com", DB_USER: "ccai_app.myref", DB_PASSWORD: "pw", DB_PORT: "5432", DB_NAME: "other" }),
    );
    expect(c.connectionString).toBe("postgres://ccai_app.myref:pw@x.pooler.supabase.com:5432/other");
  });

  it("足りない・不正なときは、秘密を含まない ConfigError", () => {
    expect(() => buildDatabaseConnection(env({}))).toThrow(ConfigError);
    expect(() => buildDatabaseConnection(env({ DB_HOST: "h" }))).toThrow(ConfigError);
    expect(() => buildDatabaseConnection(env({ DB_HOST: "x.pooler.supabase.com", DB_PASSWORD: "secretpw" }))).toThrow(/SUPABASE_URL/);
    try {
      buildDatabaseConnection(env({ DB_HOST: "h", DB_PASSWORD: "secretpw", DB_PORT: "abc" }));
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("secretpw");
    }
  });
});
