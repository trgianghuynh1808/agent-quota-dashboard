import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      manifest: {
        name: 'Agent Quota Dashboard',
        short_name: 'AgentQuota',
        description: 'Dashboard for agent quotas and telemetry',
        display: 'standalone',
        start_url: '/',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
})
