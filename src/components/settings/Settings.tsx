import { Match, Switch, createSignal, type Component } from 'solid-js';
import type { ShotSettingsSnapshot } from '../../snapshot';
import type { WsStream } from '../../streams';
import { AppTab } from './AppTab';
import { GatewayTab } from './GatewayTab';
import { LibraryTab } from './LibraryTab';
import { MachineTab } from './MachineTab';

/**
 * Global Settings screen. Three tabs (App / Gateway / Machine) covering
 * skin preferences, gateway connection, and DE1 machine settings. Renders
 * full-screen, replacing Home while open; LiveBrewDrawer still overlays on
 * top from App.tsx so an in-progress brew remains visible.
 *
 * Tab switching is local state — no URL routing yet. Tab choice does not
 * persist across opens (intentional: re-opening from the header should land
 * back on App, the most common tab).
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
}

type Tab = 'app' | 'gateway' | 'machine' | 'library';

const TABS: { id: Tab; label: string }[] = [
  { id: 'app', label: 'App' },
  { id: 'gateway', label: 'Gateway' },
  { id: 'machine', label: 'Machine' },
  { id: 'library', label: 'Library' },
];

export const Settings: Component<SettingsProps> = (p) => {
  const [tab, setTab] = createSignal<Tab>('app');

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
            <AppTab />
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
        </Switch>
      </div>
    </div>
  );
};
