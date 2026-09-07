import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', '')
  const proxyTarget =
    process.env.VITE_API_PROXY_TARGET ??
    env.VITE_API_PROXY_TARGET ??
    'http://localhost:3125'
  const allowedHosts = (
    process.env.VITE_ALLOWED_HOSTS ??
    env.VITE_ALLOWED_HOSTS ??
    ''
  )
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean)

  return {
    envDir: '..',
    plugins: [react(), tailwindcss()],
    define: {
      __RSVP_VERSION__: JSON.stringify(packageJson.version),
    },
    server: {
      allowedHosts,
      proxy: {
        '/api': { target: proxyTarget, changeOrigin: true },
        '/swagger-ui': { target: proxyTarget, changeOrigin: true },
        '/branding': { target: proxyTarget, changeOrigin: true },
      },
    },
    preview: {
      allowedHosts,
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      // Date/slot math is specified against Europe/Berlin wall-clock behaviour
      // (incl. DST transitions), so pin the test timezone.
      env: { TZ: 'Europe/Berlin' },
    },
  }
})
