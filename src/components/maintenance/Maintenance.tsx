import { Match, Switch, createSignal, type Component } from 'solid-js';
import type { Cleaning } from '../../domain';
import { CleaningRunSection } from './CleaningRunSection';

/**
 * Maintenance overlay — a Settings-peer screen for *running* machine
 * operations (as opposed to configuring them). Opened from the header's
 * Maintenance button; renders full-screen over Home like Settings.
 *
 * Sections are scaffolded with a left sub-nav so this grows naturally —
 * v1 ships just **Cleaning** (run a configured cleaning); later sections
 * (Transport Mode, Calibrate, …) slot in alongside. See
 * docs/plans/cleaning-feature.md.
 */
export interface MaintenanceProps {
  onBack: () => void;
  onClose: () => void;
  /** Launch a cleaning's runtime. Omitted until the wizard lands → Run is
   *  shown disabled. */
  onRunCleaning?: (cleaning: Cleaning) => void;
}

type Section = 'cleaning';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'cleaning', label: 'Cleaning' },
  // Transport Mode, Calibrate, … land here later.
];

export const Maintenance: Component<MaintenanceProps> = (p) => {
  const [section, setSection] = createSignal<Section>('cleaning');

  return (
    <div class="settings" data-testid="maintenance">
      <header class="settings__header">
        <button
          type="button"
          class="icon-btn"
          aria-label="Back"
          onClick={p.onBack}
        >
          ←
        </button>
        <h1 class="settings__title">Maintenance</h1>
        <button
          type="button"
          class="icon-btn"
          aria-label="Close maintenance"
          onClick={p.onClose}
        >
          ×
        </button>
      </header>

      <nav
        class="settings__tabs"
        role="tablist"
        aria-label="Maintenance sections"
      >
        {SECTIONS.map((s) => (
          <button
            type="button"
            role="tab"
            class="settings__tab"
            aria-selected={section() === s.id}
            data-active={section() === s.id}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div class="settings__content" role="tabpanel">
        <Switch>
          <Match when={section() === 'cleaning'}>
            <CleaningRunSection onRun={p.onRunCleaning} />
          </Match>
        </Switch>
      </div>
    </div>
  );
};
