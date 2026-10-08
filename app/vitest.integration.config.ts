// 結合テスト用の設定（本物の Supabase／公開URLに接続する）。npm test の対象外。起動は GitHub Actions の手動実行（.github/workflows/integration.yml）
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/integration/**/*.itest.ts"],
    // 同じプロジェクトに対して、ファイルを1つずつ順番に流す（件数の前後比較が、他のファイルの一時ユーザーに影響されないように）
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { concurrent: false, shuffle: false },
    // 失敗時の差分表示を短くする（値は ok / sameNumber などで出さない書き方にしているが、念のため）
    chaiConfig: { truncateThreshold: 40 },
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
