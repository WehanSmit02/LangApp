import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { BRAND } from "./src/config/brand.ts";

function localCurriculumDevPlugin(): Plugin {
  const curriculumRoot = path.resolve(process.cwd(), "curriculum");

  return {
    name: "local-curriculum-dev-middleware",
    configureServer(server) {
      server.middlewares.use("/curriculum", (req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          next();
          return;
        }

        const rawPath = (req.url ?? "/").split("?")[0];
        const decodedPath = decodeURIComponent(rawPath).replace(/^\/+/, "");
        const resolved = path.resolve(curriculumRoot, decodedPath);

        if (
          resolved !== curriculumRoot &&
          !resolved.startsWith(`${curriculumRoot}${path.sep}`)
        ) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }

        if (!existsSync(resolved) || !statSync(resolved).isFile()) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "Curriculum resource not found" }));
          return;
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");

        if (req.method === "HEAD") {
          res.end();
          return;
        }

        createReadStream(resolved).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: "/",
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
    localCurriculumDevPlugin(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.svg"],
      manifest: {
        name: BRAND.appName,
        short_name: BRAND.appName,
        description:
          "Adaptive offline-first multi-language courses with spaced repetition, graded stories, and audio practice.",
        theme_color: "#F2F2F7",
        background_color: "#F2F2F7",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
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
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/\/curriculum\//],
      },
    }),
  ],
});
