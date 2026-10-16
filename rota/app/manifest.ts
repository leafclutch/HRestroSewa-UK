import type { MetadataRoute } from "next";

// The Rota PWA's own manifest — a separate installable app from the main HRestroSewa
// one (different origin, different id). It starts on "/", which sends the device back
// to the restaurant it last opened.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "HRestroSewa Rota",
    short_name: "Rota",
    description: "Your shifts, the rota and hourly wages.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#f6f9fc",
    theme_color: "#f6f9fc",
    orientation: "portrait-primary",
    categories: ["business", "productivity"],
    lang: "en",
    dir: "ltr",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-256.png", sizes: "256x256", type: "image/png", purpose: "any" },
      { src: "/icons/icon-384.png", sizes: "384x384", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
