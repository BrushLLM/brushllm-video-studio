import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server needs inline module scripts (react-refresh); production keeps
// the strict CSP from index.html untouched.
const devCsp = () => ({
  name: 'dev-csp',
  transformIndexHtml: {
    order: 'pre',
    handler(html, ctx) {
      if (!ctx.server) return html;
      return html.replace(
        /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/,
        '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; connect-src \'self\' ws: http://localhost:5188">'
      );
    }
  }
});

export default defineConfig({
  root: 'src',
  base: './',
  plugins: [react(), devCsp()],
  build: {
    outDir: '../dist',
    emptyOutDir: true
  },
  server: {
    port: 5188,
    strictPort: true
  }
});
