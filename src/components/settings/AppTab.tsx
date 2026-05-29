import { Match, Switch, createSignal, type Component } from 'solid-js';
import { DisplaySection } from './sections/DisplaySection';
import { AlertsSection } from './sections/AlertsSection';
import { AboutSection } from './sections/AboutSection';
import { DeveloperSection } from './sections/DeveloperSection';

/**
 * App tab — skin-side UI preferences. Sectioned into a left side-nav so
 * unrelated controls (display formatting vs. alert thresholds) live in
 * their own panes rather than competing on one scrolling page. New
 * subsections can plug in by extending SECTIONS and adding a Match arm.
 */
type SectionId = 'display' | 'alerts' | 'about' | 'developer';

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'display', label: 'Display' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'about', label: 'About' },
  { id: 'developer', label: 'Developer' },
];

export const AppTab: Component = () => {
  const [section, setSection] = createSignal<SectionId>('display');

  return (
    <div class="settings-subnav">
      <nav class="settings-subnav__nav" role="tablist" aria-label="App settings sections">
        {SECTIONS.map((s) => (
          <button
            type="button"
            role="tab"
            class="settings-subnav__tab"
            aria-selected={section() === s.id}
            data-active={section() === s.id}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div class="settings-subnav__content" role="tabpanel">
        <Switch>
          <Match when={section() === 'display'}>
            <DisplaySection />
          </Match>
          <Match when={section() === 'alerts'}>
            <AlertsSection />
          </Match>
          <Match when={section() === 'about'}>
            <AboutSection />
          </Match>
          <Match when={section() === 'developer'}>
            <DeveloperSection />
          </Match>
        </Switch>
      </div>
    </div>
  );
};
