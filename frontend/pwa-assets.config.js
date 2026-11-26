import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    transparent: {
      ...minimal2023Preset.transparent,
      favicons: [[48, 'public/favicon.ico']],
    },
    maskable: {
      ...minimal2023Preset.maskable,
      resizeOptions: { background: '#171717', fit: 'contain' },
    },
    apple: {
      ...minimal2023Preset.apple,
      resizeOptions: { background: '#171717', fit: 'contain' },
    },
    assetName: (type, size) => {
      if (type === 'transparent') return `public/pwa-${size.width}x${size.height}.png`
      if (type === 'maskable') return `public/maskable-icon-${size.width}x${size.height}.png`
      return `public/apple-touch-icon-${size.width}x${size.height}.png`
    },
  },
  images: ['pwa-source.png'],
})
