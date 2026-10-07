import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // 認証基盤・DB の接続先を実環境から拾わない（.env なし・キーなしと同じ状態でテストする）
    env: {
      SUPABASE_URL: "",
      SUPABASE_ANON_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      DATABASE_URL: "",
      DB_HOST: "",
      DB_PASSWORD: "",
      SIGNUP_ALLOWED_EMAILS: "",
    },
  },
});
