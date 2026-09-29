import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 固定根目录，避免将上级目录中的 package-lock.json 纳入追踪范围。
  outputFileTracingRoot: process.cwd(),
  images: {
    localPatterns: [{ pathname: "/api/images/**" }],
  },
};

export default nextConfig;
