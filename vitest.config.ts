import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';
import pkg from './package.json';

export default defineConfig({
  // Mirror the build-time constants injected by vite.config.ts so components
  // that read them (e.g. AboutSection) render under test. The commit is fixed
  // to "test" here — its real value is irrelevant to assertions.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_COMMIT__: JSON.stringify('test'),
    __BUILD_TIME__: JSON.stringify('test'),
  },
  plugins: [solid()],
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: { url: 'http://localhost/' },
    },
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    conditions: ['development', 'browser'],
  },
});
