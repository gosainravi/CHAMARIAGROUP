import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Konva optionally requires the native "canvas" package for Node; we only render it in the browser.
  webpack: (config) => {
    config.resolve.alias = { ...(config.resolve.alias || {}), canvas: false };
    return config;
  },
};

export default nextConfig;
