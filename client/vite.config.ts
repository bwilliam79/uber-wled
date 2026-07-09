import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  server: {
    proxy: {
      // Defaults to the local dev server; set VITE_API_PROXY to point the dev
      // UI at another backend (e.g. a live instance) for data-rich previews.
      '/api': process.env.VITE_API_PROXY || 'http://localhost:3000'
    }
  }
})
