import type { Component } from 'solid-js';

/**
 * Profiles library — espresso profiles referenced by `profile-selection`
 * Step config. Empty shell. Profile format is reaprime's JSON shape (see
 * reaprime/doc/Profiles.md); future Profile CRUD imports/exports there.
 */
export const ProfilesSection: Component = () => (
  <div class="settings-section-stack">
    <section class="settings-section">
      <h2>Profiles</h2>
      <p class="settings-help">
        TODO — profile CRUD (title, steps, beverage type). Imports/exports
        reaprime's JSON profile format.
      </p>
    </section>
  </div>
);
