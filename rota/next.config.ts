import path from "node:path";
import type { NextConfig } from "next";

// The Rota PWA — a separate front end deployed on its own domain, talking to the
// main app's /api/rota (see app/api/rota/[...path]/route.ts in the repo root).
//
// It has NO package.json and NO node_modules of its own on purpose: it runs from
// the repo root's node_modules (`npm run rota:dev` = `next dev rota`), so the rota
// screens it shares with the main app (components/rota/*) and the app itself load
// ONE copy of React. Two copies would break every hook in the shared components.
//
// The workspace root is the repo root, because the shared code lives there.
const repoRoot = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // The shared rota components are written against the main app's design system;
  // nothing here needs image optimisation from a remote host.
  images: { unoptimized: true },
  async headers() {
    return [
      {
        // The worker must never be served stale, or an update can never land.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
