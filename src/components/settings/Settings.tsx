import { Match, Switch, createSignal, type Component } from 'solid-js';
import type { ShotSettingsSnapshot, WaterLevelsSnapshot } from '../../snapshot';
import type { WsStream } from '../../streams';
import { AppTab } from './AppTab';
import { AboutTab } from './AboutTab';
import { GatewayTab } from './GatewayTab';
import { LibraryTab } from './LibraryTab';
import { MachineTab } from './MachineTab';

/**
 * Global Settings screen. Tabs (Library / App / Machine / About) covering
 * skin preferences, DE1 machine settings, and machine/app/developer info.
 * Renders
 * full-screen, replacing Home while open; LiveBrewDrawer still overlays on
 * top from App.tsx so an in-progress brew remains visible.
 *
 * Tab switching is local state — no URL routing yet. Tab choice does not
 * persist across opens (intentional: re-opening from the header should land
 * back on Library, the most-used tab).
 *
 * `onBack` and `onClose` both dismiss the screen today. They're kept distinct
 * so when sub-pages land (e.g. an editor opened from within Settings), `←`
 * can pop one level while `×` still exits the whole screen.
 */
export interface SettingsProps {
  onBack: () => void;
  onClose: () => void;
  /** Live shotSettings stream, passed through to the Machine tab for the
   *  steam temperature/duration sliders. Optional so tests can mount Settings
   *  without wiring streams. */
  shotSettingsStream?: WsStream<ShotSettingsSnapshot>;
  /** Live water-levels stream, passed to the App tab's Alerts section so the
   *  Critical threshold can read/write the machine's refill level. */
  waterLevelsStream?: WsStream<WaterLevelsSnapshot>;
}

type Tab = 'app' | 'gateway' | 'machine' | 'library' | 'about';

const TABS: { id: Tab; label: string }[] = [
  { id: 'library', label: 'Library' },
  { id: 'app', label: 'App' },
  { id: 'machine', label: 'Machine' },
  { id: 'about', label: 'About' },
  // Gateway tab hidden for now — the GatewayTab component + its Match arm are
  // kept below so re-enabling is just restoring this entry.
];

export const Settings: Component<SettingsProps> = (p) => {
  const [tab, setTab] = createSignal<Tab>('library');

  return (
    <div class="settings" data-testid="settings">
      <header class="settings__header">
        <button
          type="button"
          class="icon-btn"
          aria-label="Back"
          onClick={p.onBack}
        >
          ←
        </button>
        <h1 class="settings__title">Settings</h1>
        <button
          type="button"
          class="icon-btn"
          aria-label="Close settings"
          onClick={p.onClose}
        >
          ×
        </button>
      </header>

      <nav class="settings__tabs" role="tablist" aria-label="Settings sections">
        {TABS.map((t) => (
          <button
            type="button"
            role="tab"
            class="settings__tab"
            aria-selected={tab() === t.id}
            data-active={tab() === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div class="settings__content" role="tabpanel">
        <Switch>
          <Match when={tab() === 'app'}>
            <AppTab waterLevelsStream={p.waterLevelsStream} />
          </Match>
          <Match when={tab() === 'gateway'}>
            <GatewayTab />
          </Match>
          <Match when={tab() === 'machine'}>
            <MachineTab shotSettingsStream={p.shotSettingsStream} />
          </Match>
          <Match when={tab() === 'library'}>
            <LibraryTab shotSettingsStream={p.shotSettingsStream} />
          </Match>
          <Match when={tab() === 'about'}>
            <AboutTab />
          </Match>
        </Switch>
      </div>
    </div>
  );
};
