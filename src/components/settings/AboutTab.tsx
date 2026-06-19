import type { Component } from 'solid-js';
import { MachineInfoSection } from './sections/MachineInfoSection';
import { AppSection } from './sections/AppSection';
import { DeveloperSection } from './sections/DeveloperSection';

/**
 * About tab — read-only machine identity, app info (gateway + skin build), and
 * developer tools, each a card stacked on one scrolling page. Machine identity
 * moved here from the Machine tab; the App and Developer cards moved here from
 * the App tab's sub-nav. The App and Developer cards each group their content
 * into `settings-subsection`s under one h2.
 */
export const AboutTab: Component = () => (
  <div class="settings-section-stack">
    <MachineInfoSection />
    <AppSection />
    <DeveloperSection />
  </div>
);
