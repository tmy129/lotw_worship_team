import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// The LINE rich-menu portal, emitted as dist/liff.html beside the full app.
// A second pass rather than a second rollup input: vite-plugin-singlefile turns
// code splitting off to inline everything, and rollup rejects multiple inputs in
// that mode. emptyOutDir is false so this pass adds to what the main build left.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: 'liff.html',
    },
  },
})
