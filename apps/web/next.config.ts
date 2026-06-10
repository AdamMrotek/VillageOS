import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@repo/ui"],
  images: {
    // Provider logos are served from CloudFront (dxxxx.cloudfront.net). Pin the
    // exact distribution domain here once it's deployed.
    remotePatterns: [{ protocol: "https", hostname: "**.cloudfront.net" }],
  },
};

export default nextConfig;
