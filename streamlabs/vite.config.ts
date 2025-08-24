import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    remix({
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_singleFetch: true,
        v3_lazyRouteDiscovery: true,
      },
    }),
    tsconfigPaths(),
  ],
  server: {
    allowedHosts: [
      'data-themes-uni-plasma.trycloudflare.com',
      'streamlabs.local.woofx3.tv'
    ],
    hmr: {
      protocol: 'wss',
      port: 24678,
      clientPort:443,
      host: "streamlabs.local.woofx3.tv",
    }
  }
});
