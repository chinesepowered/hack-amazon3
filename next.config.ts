import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Strands dynamically imports optional AWS SDK packages; keep it out of the Turbopack bundle.
  serverExternalPackages: ["@strands-agents/sdk"],
};

export default nextConfig;
