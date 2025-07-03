import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    origin: 'http://127.0.0.1:5173',
    watch: {
      usePolling: true,
    },
    host: true, // needed for the Docker Container port mapping to work
    strictPort: true,
    port: 5173, // you can replace this port with any port
    allowedHosts: ['ui.local.woofx3.tv']
  },
  build: {
    manifest: true,
    outDir: 'dist',
    rollupOptions: {
      // overwrite default .html entry
      input: '/src/main.ts',
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  base: './'
})
