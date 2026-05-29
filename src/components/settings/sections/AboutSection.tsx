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
        A focused, recipe-driven interface for your Decent espresso machine.
      </p>
      <p class="settings-help" data-testid="about-repo">
        <a
          href="https://github.com/rotium/OverDose"
          target="_blank"
          rel="noopener noreferrer"
        >
          github.com/rotium/OverDose
        </a>
      </p>
      <p class="settings-help" data-testid="about-license">
        Licensed under{' '}
        <a
          href="https://www.gnu.org/licenses/gpl-3.0.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          GPL-3.0
        </a>
        .
      </p>
    </section>
  </div>
);
