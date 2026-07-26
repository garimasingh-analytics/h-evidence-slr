import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack config (Next.js 16 default bundler)
  // pdfjs-dist tries to require 'canvas' in Node — resolve it to false in the browser bundle.
  turbopack: {
    resolveAlias: {
      canvas: { browser: './node_modules/next/dist/client/compat/side-effect.js' },
    },
  },
};

export default nextConfig;
