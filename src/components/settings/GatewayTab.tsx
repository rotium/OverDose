import type { Component } from 'solid-js';

/**
 * Gateway tab — connection between skin and reaprime. Empty shell while
 * scope is decided. Planned controls (per the Settings plan):
 *   - Gateway host (currently the `GATEWAY_HOST` build-time env var)
 *   - Live connection status per WebSocket (machine / scale / shotSettings / waterLevels)
 *   - Reconnect button
 *   - Log level / debug toggle
 */
export const GatewayTab: Component = () => (
  <div class="settings-section-stack">
    <section class="settings-section">
      <h2>Gateway</h2>
      <p class="settings-help">
        TODO — host, per-stream connection status, reconnect, log level.
      </p>
    </section>
  </div>
);
