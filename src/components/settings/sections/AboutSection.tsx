import type { Component } from 'solid-js';

/**
 * About subsection — identifies the running build. The version comes from
 * package.json and the short git commit is injected at build time
 * (see vite.config.ts); the commit reads "dev" outside a git checkout.
 */
export const AboutSection: Component = () => (
  <div class="settings-section-stack">
    <section class="settings-section" aria-labelledby="about-heading">
      <h2 id="about-heading">About</h2>
      <p class="settings-help" data-testid="app-version">
        OverDose v{__APP_VERSION__} · {__GIT_COMMIT__}
      </p>
      <p class="settings-help">
        A SolidJS skin for Decent (DE1) espresso machines.
      </p>
    </section>
  </div>
);
