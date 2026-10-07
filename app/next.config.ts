import type { NextConfig } from "next";

// 個人の情報を含みうる画面・APIは、ブラウザや中継にキャッシュさせない（SPEC-000a AC-7, AC-17）
const noStore = [{ key: "Cache-Control", value: "no-store, max-age=0" }];
const common = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  // check-build.mjs が開発用の .next を壊さないために出力先を切り替える
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
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
