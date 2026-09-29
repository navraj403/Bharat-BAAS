import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // postgres.js uses Node-only APIs (net/tls); load it with native require on the server
  // instead of bundling it.
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
