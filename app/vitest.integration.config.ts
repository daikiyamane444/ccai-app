// 結合テスト用の設定（本物の Supabase／公開URLに接続する）。npm test の対象外。起動は GitHub Actions の手動実行（.github/workflows/integration.yml）
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/integration/**/*.itest.ts"],
    fileParallelism: false, // 同じプロジェクトに対して順番に流す（件数の前後比較のため）
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
