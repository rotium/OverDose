import { Show, createResource, type Component } from 'solid-js';
import { api, type MachineSettingsSnapshot } from '../../api';
import { DebouncedSliderField } from './DebouncedSliderField';

/**
 * Machine tab — DE1 settings, all routed through the gateway. Steam + Flush
 * sections today; more (hot water, shot defaults, sleep, devices, pairing)
 * will land as their scopes are resolved. Destructive fields (anything that
 * could damage the machine) will show their current value and open a confirm
 * popup for edits — see Settings plan.
 *
 * Persistence: machine settings live on the firmware (MMR), not local
 * storage. We fetch on mount and POST sparse partials on change.
 */
export const MachineTab: Component = () => {
  // `/api/v1/machine/settings` doesn't have a WS stream — it's request /
  // response only — so a one-shot resource is the right shape. If the user
  // changes the value via another client we won't see it until the tab is
  // re-opened; acceptable since this is a "set and forget" surface.
  //
  // The fetcher catches its own errors and resolves to `null` rather than
  // rejecting. That way the resource never enters an unhandled-error state
  // (Solid leaks those as unhandled promise rejections), and the UI just
  // checks `settings() === null` to render the "couldn't load" copy.
  const [settings, { refetch }] = createResource<MachineSettingsSnapshot | null>(
    async () => {
      try {
        return await api.machineSettings();
      } catch (e) {
        console.warn('machineSettings fetch failed', e);
        return null;
      }
    },
  );

  // Sparse POST of just the changed key — the handler in de1handler.dart
  // applies every present field independently and leaves the rest alone, so
  // `commit({ flushTimeout: 8 })` only touches that one MMR. Refetch isn't
  // strictly required (the slider already shows the committed number) but it
  // confirms the firmware accepted the write and snaps the value if clamped.
  const commit = (partial: Partial<MachineSettingsSnapshot>) => {
    api
      .updateMachineSettings(partial)
      .then(() => void refetch())
      .catch((e) => console.warn('updateMachineSettings failed', e));
  };

  return (
    <div class="settings-section-stack">
      <Show
        when={!settings.loading && settings()}
        fallback={
          <p class="settings-help" data-testid="machine-settings-loading">
            {settings.loading
              ? 'Loading machine settings…'
              : 'Could not load machine settings.'}
          </p>
        }
      >
        {(s) => (
          <>
            <section class="settings-section" data-testid="machine-steam-section">
              <h2>Steam</h2>
              <p class="settings-help">
                Set how fast steam flows through the wand. Lower values give
                finer control of milk texture; higher values are faster.
                Decent.app's default is 1.0 mL/s.
              </p>
              <div class="settings-field settings-field--stack">
                <label class="settings-field__label" for="machine-steam-flow">
                  Steam flow
                </label>
                <DebouncedSliderField
                  testId="machine-steam-flow"
                  value={s().steamFlow}
                  onCommit={(steamFlow) => commit({ steamFlow })}
                  min={0.4}
                  max={2.0}
                  step={0.1}
                  ariaLabel="Steam flow in millilitres per second"
                  formatValue={(v) => `${v.toFixed(1)} mL/s`}
                />
              </div>
            </section>

            <section class="settings-section" data-testid="machine-flush-section">
              <h2>Flush</h2>
              <p class="settings-help">
                The group-head rinse default. Timeout is how long a flush runs
                before it auto-stops; flow is how fast water passes through the
                group head.
              </p>
              <div class="settings-field settings-field--stack">
                <label class="settings-field__label" for="machine-flush-timeout">
                  Flush timeout
                </label>
                <DebouncedSliderField
                  testId="machine-flush-timeout"
                  value={s().flushTimeout}
                  onCommit={(flushTimeout) => commit({ flushTimeout })}
                  min={3}
                  max={120}
                  step={1}
                  ariaLabel="Flush timeout in seconds"
                  formatValue={(v) => `${v.toFixed(0)} s`}
                />
              </div>
              <div class="settings-field settings-field--stack">
                <label class="settings-field__label" for="machine-flush-flow">
                  Flush flow
                </label>
                <DebouncedSliderField
                  testId="machine-flush-flow"
                  value={s().flushFlow}
                  onCommit={(flushFlow) => commit({ flushFlow })}
                  min={1}
                  max={10}
                  step={0.5}
                  ariaLabel="Flush flow in millilitres per second"
                  formatValue={(v) => `${v.toFixed(1)} mL/s`}
                />
              </div>
            </section>
          </>
        )}
      </Show>
    </div>
  );
};
