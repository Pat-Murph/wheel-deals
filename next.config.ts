import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable static page generation — all pages render dynamically at request time.
  // This prevents Firebase/Stripe from being called at build time when env vars are unavailable.
  output: "standalone",
  experimental: {
    // Force all pages to be server-rendered (no static prerendering)
  },
};

export default nextConfig;
