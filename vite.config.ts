import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

// Build-time env, read defensively (this project has no @types/node).
const env =
  (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {};

// Point the dev server at a running Decent.app gateway.
// Override with: GATEWAY_HOST=192.168.1.42:8080 npm run dev
const GATEWAY_HOST = env.GATEWAY_HOST ?? 'localhost:8080';

// Short git commit of the build, injected by the `build` script
// (GIT_COMMIT=...). Falls back to "dev" for `npm run dev` and tarball builds.
const GIT_COMMIT = env.GIT_COMMIT ?? 'dev';

// Released version, injected from the git tag by the release workflow
// (OVERDOSE_VERSION=...). Falls back to "0.0.dev" for local/dev builds.
const APP_VERSION = env.OVERDOSE_VERSION ?? '0.0.dev';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __GIT_COMMIT__: JSON.stringify(GIT_COMMIT),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [solid()],
  server: {
    proxy: {
      '/api': {
        target: `http://${GATEWAY_HOST}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://${GATEWAY_HOST}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
