import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

// Point the dev server at a running Decent.app gateway.
// Override with: GATEWAY_HOST=192.168.1.42:8080 npm run dev
const GATEWAY_HOST = process.env.GATEWAY_HOST ?? 'localhost:8080';

export default defineConfig({
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
