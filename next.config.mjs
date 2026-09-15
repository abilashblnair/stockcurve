import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output: the server ships only what it needs (deploy/push.sh).
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  // OneDrive locks files inside the project's .next while syncing; allow another build folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  serverExternalPackages: ["@meteora-ag/dynamic-bonding-curve-sdk", "@coral-xyz/anchor"],
  poweredByHeader: false,
};
export default nextConfig;
