import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build: {
    rolldownOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        options: resolve(import.meta.dirname, 'options.html'),
        background: resolve(import.meta.dirname, 'src/background/background.ts'),
        content: resolve(import.meta.dirname, 'src/content/content.ts'),
      },
      // Release builds drop debug logging (console.warn/error stay for real problems)
      treeshake: mode === 'production'
        ? { manualPureFunctions: ['console.log', 'console.info', 'console.debug'] }
        : undefined,
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background' || chunkInfo.name === 'content') {
            return '[name].js'
          }
          return 'assets/[name]-[hash].js'
        },
      },
    },
  },
}))
