import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/** Copy the pre-built widget-host shim IIFE into the build output so
 *  the frame assembler can reference it at a stable relative URL. The
 *  shim is NOT imported by the SPA bundle — it is loaded directly by
 *  the assembled widget frame document via a classic script tag. */
function copyWidgetHostShim(): Plugin {
  const shimSrc = resolve(
    __dirname,
    "../../shared/clients/typescript/module-sdk/dist/widget-host-shim.js",
  );

  return {
    name: "copy-widget-host-shim",
    generateBundle() {
      let shimCode: string;
      try {
        shimCode = readFileSync(shimSrc, "utf-8");
      } catch (err) {
        // Warn but don't break the build — the shim may not be pre-built
        // in CI environments that build the SPA independently.
        console.warn("[copy-widget-host-shim] shim not found at", shimSrc, err);
        return;
      }
      this.emitFile({
        type: "asset",
        fileName: "assets/widget-host-shim.js",
        source: shimCode,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendUrl = env.STREAMWARE_BACKEND_URL || "http://localhost:9101";

  return {
    plugins: [react(), copyWidgetHostShim()],
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
      // Relative asset URLs so the SPA renders correctly through the
      // api proxy without a fixed path prefix (design §5.1).
      base: "./",
    },
    base: "./",
    server: {
      port: 5173,
      host: true,
      proxy: {
        // Module-state WS and health-check forwarded to the streamware backend.
        "/ws/module-state": { target: backendUrl, ws: true, changeOrigin: true },
        "/health": { target: backendUrl, changeOrigin: true },
        // Token-mode overlay — HTTP (config fetch), WS (events), and frame assets.
        "/o/": { target: backendUrl, ws: true, changeOrigin: true },
      },
      allowedHosts: ["streamlabs.local.woofx3.tv", "streamware.local.woofx3.tv"],
    },
  };
});
