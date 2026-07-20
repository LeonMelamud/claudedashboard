import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// The dev proxy must target the same port the server actually binds. Read the
// repo-root .env (where PORT lives) so the two can't drift — a mismatch makes
// every /api call 500 with an unhelpful proxy error.
export default defineConfig(({ mode }) => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const rootEnv = loadEnv(mode, repoRoot, '');

  const devPort = Number(process.env.VITE_PORT ?? rootEnv.VITE_PORT ?? 5173);
  const serverPort = rootEnv.PORT ?? '8080';
  const apiProxyTarget =
    process.env.VITE_API_PROXY_TARGET ?? rootEnv.VITE_API_PROXY_TARGET ?? `http://localhost:${serverPort}`;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: devPort,
      proxy: {
        '/api': apiProxyTarget,
      },
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 1500,
    },
  };
});
