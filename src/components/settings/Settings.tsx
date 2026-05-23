import { Match, Switch, createSignal, type Component } from 'solid-js';
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
            <MachineTab />
          </Match>
          <Match when={tab() === 'library'}>
            <LibraryTab />
          </Match>
        </Switch>
      </div>
    </div>
  );
};
