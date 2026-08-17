import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function resolveBuildId(): string {
  const raw =
    (typeof process.env.VERCEL_GIT_COMMIT_SHA === 'string' && process.env.VERCEL_GIT_COMMIT_SHA) ||
    (typeof process.env.VITE_BUILD_ID === 'string' && process.env.VITE_BUILD_ID) ||
    ''
  const short = String(raw).replace(/[^a-fA-F0-9]/g, '').slice(0, 7)
  return short || 'dev'
}

export default defineConfig({
  plugins: [react()],
  define: {
    __SHINKAIDO_BUILD_ID__: JSON.stringify(resolveBuildId()),
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    // Local `vite` has no /api — proxy to `vercel dev` (or VITE_DEV_API_PROXY).
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_PROXY || 'http://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
  },
})
