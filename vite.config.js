import { defineConfig } from 'vite';

// Mirrors the CSP set by nginx in production
// (vps/nginx/sites/machines-demo.mellonis.ru) so that policy-breaking changes
// are caught at `npm run dev`, not after deploy.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:", // ws/wss for Vite HMR; nginx config drops these
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

export default defineConfig({
  server: {
    port: 5173,
    headers: {
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  },
});
