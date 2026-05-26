import type { Component } from 'solid-js';
import { ProfilePicker } from './ProfilePicker';

/**
 * Profiles library — espresso profiles fetched from the gateway. Unlike
 * Beverages and Recipes (local-first, behind the Repository interface),
 * profiles are gateway-owned (reaprime/doc/Profiles.md) — this section
 * renders a read-only browse view of `/api/v1/profiles?visibility=visible`.
 *
 * The `--fill` modifier on the wrapper makes the section claim the
 * available height of the settings sub-nav content area so the picker's
 * list + detail columns can each scroll independently instead of pushing
 * the whole page scroll. Other Library subsections (Beverages, Recipes)
 * don't use this — their list lengths are smaller and a page-level
 * scroll is fine.
 */
export const ProfilesSection: Component = () => (
  <div class="settings-section-stack settings-section-stack--fill">
    <section
      class="settings-section settings-section--fill"
      aria-labelledby="library-profiles-heading"
    >
      <h2 id="library-profiles-heading">Profiles</h2>
      <p class="settings-help">
        Espresso profiles loaded on the gateway. Recipes pick one of these
        to define how each shot is pulled. Browse-only for now — importing
        and editing are still on the way.
      </p>
      <ProfilePicker />
    </section>
  </div>
);
