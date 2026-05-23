import type { Component } from 'solid-js';

/**
 * Beans library — referenced by `bean-selection` Step config. Empty shell
 * until Bean CRUD is built; eventually maps to reaprime's BeanStorageService.
 */
export const BeansSection: Component = () => (
  <div class="settings-section-stack">
    <section class="settings-section">
      <h2>Beans</h2>
      <p class="settings-help">
        TODO — bean CRUD (name, roaster, roast date, notes). Eventually
        syncs to the gateway's BeanStorageService.
      </p>
    </section>
  </div>
);
