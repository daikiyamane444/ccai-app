import type { NextConfig } from "next";

// 個人の情報を含みうる画面・APIは、ブラウザや中継にキャッシュさせない（SPEC-000a AC-7, AC-17）
const noStore = [{ key: "Cache-Control", value: "no-store, max-age=0" }];
const common = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // 個人用URL。検索エンジンに載せない（SPEC-000c AC-7）。robots.txt（public/）と、各ページの meta robots（layout.tsx）も併用する
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
];

const nextConfig: NextConfig = {
  // check-build.mjs が開発用の .next を壊さないために出力先を切り替える
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  // Claude Agent SDK（評価コマンド用の開発依存。約250MBの実行ファイルを含む）を、公開用の関数に含めない（SPEC-000b。本番ではプラン方式を使わない）
  outputFileTracingExcludes: { "*": ["node_modules/@anthropic-ai/**"] },
  reactStrictMode: true,
  async headers() {
    return [
      { source: "/:path*", headers: common },
      { source: "/", headers: noStore },
      { source: "/login", headers: noStore },
      { source: "/register", headers: noStore },
      { source: "/api/:path*", headers: noStore },
    ];
  },
};

export default nextConfig;
