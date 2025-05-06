import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path'; // Use Node.js built-in path module

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Define the base path for deployment (e.g., for GitHub Pages)
  // If deploying to '/verification/', keep this.
  // If deploying to the root of a custom domain, use '/' or remove it.
  base: '/verification/',
  resolve: {
    alias: {
      // Use path.resolve with an absolute path.
      // For ES modules, __dirname is not available directly.
      // Vite's environment for vite.config.ts usually allows Node.js globals.
      // If __dirname still causes issues, you might need to use:
      // '@': new URL('./src', import.meta.url).pathname
      // However, for Vite config, `path.resolve` is common.
      '@': path.resolve(__dirname, './src'),
    },
  },
  // If you have specific server options for development
  server: {
    port: 3000, // Example port
    open: true,   // Example: open browser on start
  },
  // If you have specific build options
  build: {
    outDir: 'dist', // Default output directory
  }
});
