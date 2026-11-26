import process from 'node:process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Fecha de la compilación: se muestra junto a «Actualizar app» para saber qué versión tiene cada teléfono.
  define: { 'import.meta.env.VITE_BUILD': JSON.stringify(new Date().toISOString()) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        id: '/',
        name: 'Mantenimiento Travel Trans',
        short_name: 'Mantenimiento',
        description: 'Gestión de mantenimiento, inspecciones y tareas de la flota Travel Trans.',
        lang: 'es-CL',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#FFFFFF',
        theme_color: '#FFFFFF',
        categories: ['business', 'productivity'],
        icons: [
          { src: '/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
        cleanupOutdatedCaches: true,
        // Modo aviso: la versión nueva espera hasta que la app la aplique (sola si no hay nada abierto, o con «Actualizar»).
        clientsClaim: true,
        skipWaiting: false,
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/[^/]+\/(?:api|uploads)\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  // API_PROXY permite apuntar el servidor de desarrollo a otro puerto del backend.
  server: { proxy: { '/api': process.env.API_PROXY || 'http://127.0.0.1:5000', '/uploads': process.env.API_PROXY || 'http://127.0.0.1:5000' } },
})
