import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Where `/api` is proxied in dev. With VITE_MOCK=1 the site never calls it. */
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://127.0.0.1:8820'

export default defineConfig({
  plugins: [react()],
  server: { port: 5270, strictPort: true, proxy: { '/api': { target: API_ORIGIN, changeOrigin: false } } },
  preview: { port: 5271, strictPort: true, proxy: { '/api': { target: API_ORIGIN, changeOrigin: false } } },
})
