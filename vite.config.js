import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// The full application. The LINE portal is built separately by
// vite.liff.config.js: vite-plugin-singlefile disables code splitting, which
// rollup refuses to combine with more than one input, so the two pages are two
// passes over the same dist rather than two inputs to one pass.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'dist',
  },
})
