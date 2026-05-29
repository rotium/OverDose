/**
 * Build identity, from the constants Vite/Vitest inject at build time (see
 * `vite.config.ts`). Centralised so the About screen, the Developer page, and
 * the debug-log export all report the same thing.
 */
export const BUILD_INFO = {
  version: __APP_VERSION__,
  gitHash: __GIT_COMMIT__,
  buildTime: __BUILD_TIME__,
} as const;

/** One-line build identity, e.g. as the header of an exported debug log. */
export const buildInfoLine = (): string =>
  `OverDose v${BUILD_INFO.version} · ${BUILD_INFO.gitHash} · built ${BUILD_INFO.buildTime}`;
