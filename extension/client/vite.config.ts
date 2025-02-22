import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/v1/woofx3',
  plugins: [react()],
  server: {
    allowedHosts: ['extension.local.woofx3.tv'],
    proxy: {
      '/auth': 'http://localhost:3001'
    },
    port: 5174
  }
})
