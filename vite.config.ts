import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { BRAND } from "./src/config/brand.ts";

const repoName =
  process.env.GITHUB_REPOSITORY?.split("/")[1] || BRAND.defaultRepoName;
const base = process.env.GITHUB_PAGES === "true" ? `/${repoName}/` : "/";

export default defineConfig({
  base,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("motion") || id.includes("framer-motion")) {
            return "vendor-motion";
          }
          if (id.includes("dexie") || id.includes("zod")) {
            return "vendor-data";
          }
          return "vendor-ui";
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.svg"],
      manifest: {
        name: BRAND.appName,
        short_name: BRAND.appName,
        description:
          "Adaptive on-demand Japanese and German courses with offline spaced repetition and audio practice.",
        theme_color: "#F2F2F7",
        background_color: "#F2F2F7",
        display: "standalone",
        orientation: "portrait",
        scope: base,
        start_url: base,
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        globIgnores: ["**/curriculum/**"],
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/\/curriculum\//],
      },
    }),
  ],
});
