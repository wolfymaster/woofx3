import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendUrl = env.STREAMWARE_BACKEND_URL || "http://localhost:9101";

  return {
    plugins: [react()],
    resolve: {
      alias: {
        // Resolve the @woofx3/module-sdk workspace import to its source
        // entry so Vite picks up the canonical types/runtime without
        // requiring the SDK to be built first. Mirrors the tsconfig
        // `paths` mapping below.
        "@woofx3/module-sdk": resolve(
          __dirname,
          "../../shared/clients/typescript/module-sdk/src/index.ts",
        ),
      },
    },
    // Files under streamware/public/ get served at the root URL in dev
    // and copied into dist/ during build, so production-served URLs match.
    publicDir: "../public",
    build: {
      outDir: "dist",
      sourcemap: true,
    },
    server: {
      port: 5173,
      proxy: {
        // Only the WS push streams and health-check go to the backend
        // in dev; public assets are served directly by Vite from
        // publicDir above. Both alert + module-state sockets need
        // forwarding so the SPA can connect to either overlay path
        // (`/overlay/alerts` and `/overlay/scene`) under `bun run dev`.
        "/ws/alerts": { target: backendUrl, ws: true, changeOrigin: true },
        "/ws/module-state": { target: backendUrl, ws: true, changeOrigin: true },
        "/health": { target: backendUrl, changeOrigin: true },
      },
      allowedHosts: ["streamlabs.local.woofx3.tv"],
    },
  };
});
