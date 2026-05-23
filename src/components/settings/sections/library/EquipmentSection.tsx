import type { Component } from 'solid-js';

/**
 * Equipment library — groups physical equipment the skin needs to know
 * about. Empty shell. Will host:
 *   - Grinders (referenced by `grind` Step config) — first equipment type
 *   - Scales (future)
 *   - Machines (future, when multi-machine support lands)
 *
 * When the list of equipment types grows past simple section headers,
 * promote to its own third-level sub-nav.
 */
export const EquipmentSection: Component = () => (
  <div class="settings-section-stack">
    <section class="settings-section">
      <h2>Equipment</h2>
      <p class="settings-help">
        TODO — Grinder CRUD (model, settings range). Later: Scales, Machines.
      </p>
    </section>
  </div>
);
