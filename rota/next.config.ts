import path from "node:path";
import type { NextConfig } from "next";

// The Rota PWA — a separate front end deployed on its own domain, talking to the main
// app's /api/rota (HRestroSewa/app/api/rota/[...path]/route.ts).
//
// Fully self-contained: its own package.json and node_modules, and its own COPY of the
// rota screens and helpers it renders (each copied file says so at the top). So this
// folder builds and deploys on its own — Coolify's base directory is just `rota`.

// Pinned to THIS folder. Left to infer, Next picks whichever directory above holds a
// lockfile (e.g. a checkout with the main app beside it) and traces files out of it —
// exactly what an independent deploy must not do.
const appRoot = path.resolve(__dirname);

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: appRoot,
  turbopack: { root: appRoot },
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
