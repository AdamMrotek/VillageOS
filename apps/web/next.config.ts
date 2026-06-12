import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@repo/ui"],
  // Dev-only: lets devices on the LAN (phone testing) load dev assets when the
  // app is opened via the Mac's IP. Ignored in production builds.
  allowedDevOrigins: ["192.168.1.95"],
  images: {
    // Provider logos are served from CloudFront (dxxxx.cloudfront.net). Pin the
    // exact distribution domain here once it's deployed.
    remotePatterns: [{ protocol: "https", hostname: "**.cloudfront.net" }],
  },
};

export default nextConfig;
