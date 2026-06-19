import { Match, Switch, createSignal, type Component } from 'solid-js';
import type { WaterLevelsSnapshot } from '../../snapshot';
import type { WsStream } from '../../streams';
import { DisplaySection } from './sections/DisplaySection';
import { BrewingSection } from './sections/BrewingSection';
import { AlertsSection } from './sections/AlertsSection';

/**
 * App tab — skin-side UI preferences. Sectioned into a left side-nav so
 * unrelated controls (display formatting vs. alert thresholds) live in
 * their own panes rather than competing on one scrolling page. New
 * subsections can plug in by extending SECTIONS and adding a Match arm.
 *
 * App build info + developer tools live in the About tab (see AboutTab).
 */
type SectionId = 'display' | 'brewing' | 'alerts';

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'display', label: 'Display' },
  { id: 'brewing', label: 'Brewing' },
  { id: 'alerts', label: 'Alerts' },
];

export const AppTab: Component<{
  waterLevelsStream?: WsStream<WaterLevelsSnapshot>;
}> = (p) => {
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
          <Match when={section() === 'brewing'}>
            <BrewingSection />
          </Match>
          <Match when={section() === 'alerts'}>
            <AlertsSection waterLevels={p.waterLevelsStream?.latest} />
          </Match>
        </Switch>
      </div>
    </div>
  );
};
