import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @repo/ui ships TS/TSX source (shadcn components), so Next must transpile it.
  transpilePackages: ["@repo/ui"],
};

export default nextConfig;
