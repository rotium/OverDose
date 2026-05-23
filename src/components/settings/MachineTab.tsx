import type { Component } from 'solid-js';

/**
 * Machine tab — DE1 settings, all routed through the gateway. Empty shell
 * while scope is decided. Planned controls (per the Settings plan):
 *   - Steam: target temp, target duration
 *   - Hot water: target temp, volume, duration
 *   - Shot: target volume
 *   - Sleep / wake
 *   - Devices: machine + scale connection, pair new
 * Destructive fields (anything that could damage the machine) show their
 * current value and open a confirm popup for edits — see Settings plan.
 */
export const MachineTab: Component = () => (
  <div class="settings-section-stack">
    <section class="settings-section">
      <h2>Machine</h2>
      <p class="settings-help">
        TODO — steam, hot water, shot defaults, sleep, devices.
      </p>
    </section>
  </div>
);
