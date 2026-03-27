import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {

  // ── content script: fully self-contained IIFE (no import statements) ──
  if (mode === 'content') {
    return {
      plugins: [react()],
      define: { 'process.env.NODE_ENV': '"production"' },
      build: {
        outDir: 'dist',
        emptyOutDir: false,
        lib: {
          entry: resolve(__dirname, 'src/content/content.tsx'),
          name: 'AullevoContent',
          formats: ['iife'],
          fileName: () => 'assets/content.js',
        },
        rollupOptions: {
          output: {
            inlineDynamicImports: true,
            assetFileNames: (assetInfo) => {
              if (assetInfo.name?.endsWith('.css')) {
                return 'assets/content.css';
              }
              return 'assets/[name].[ext]';
            },
          },
        },
      },
    };
  }

  // ── background service worker: ES module (MV3 requires it) ──
  if (mode === 'background') {
    return {
      plugins: [react()],
      define: { 'process.env.NODE_ENV': '"production"' },
      build: {
        outDir: 'dist',
        emptyOutDir: false,
        lib: {
          entry: resolve(__dirname, 'src/background/background.ts'),
          name: 'AullevoBackground',
          formats: ['es'],
          fileName: () => 'assets/background.js',
        },
        rollupOptions: {
          output: {
            inlineDynamicImports: true,
          },
        },
      },
    };
  }

  // ── default: popup + options HTML pages (code splitting is fine here) ──
  return {
    plugins: [react()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          popup:   resolve(__dirname, 'index.html'),
          options: resolve(__dirname, 'options.html'),
        },
        output: {
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name].[ext]',
        },
      },
    },
  };
});