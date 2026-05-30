import { Show, createResource, type Component } from 'solid-js';
import { api, type MachineSettingsSnapshot } from '../../api';
import type { ShotSettingsSnapshot } from '../../snapshot';
import type { WsStream } from '../../streams';
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
export interface MachineTabProps {
  /** Live shotSettings stream — the only source of `targetSteamTemp` /
   *  `targetSteamDuration` (the shotSettings endpoint has no REST GET).
   *  Optional: when absent (unit tests, or before streams are wired) the
   *  steam temperature/duration sliders degrade to a "connect to set" hint
   *  and only steam flow (from machineSettings) renders. */
  shotSettingsStream?: WsStream<ShotSettingsSnapshot>;
}

export const MachineTab: Component<MachineTabProps> = (p) => {
  // `/api/v1/machine/settings` has no WS stream — it's request/response only —
  // so a one-shot resource is the right shape: it fetches the machine's
  // current values each time the tab is opened (the tab unmounts/remounts via
  // the Settings <Switch>, so a fresh read happens on every open). Steam
  // temp/duration come live off the shotSettings WS below.
  //
  // The fetcher catches its own errors and resolves to `null` rather than
  // rejecting — so the resource never enters an unhandled-error state, and the
  // UI checks `settings() === null` to render the "couldn't load" copy.
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

  // Steam temperature + duration live in `shotSettings`, not machineSettings.
  // That endpoint is POST-only with a full body (no sparse PATCH) and has no
  // GET, so we read the current snapshot off the WS stream and overlay the one
  // changed field. The gateway echoes the new value back on the same stream,
  // so the slider snaps to the confirmed value without an explicit refetch.
  const shot = (): ShotSettingsSnapshot | null =>
    p.shotSettingsStream?.latest() ?? null;
  const commitShot = (partial: Partial<ShotSettingsSnapshot>) => {
    const cur = shot();
    if (!cur) return; // no base snapshot yet — can't build the full body
    api
      .updateShotSettings({ ...cur, ...partial })
      .catch((e) => console.warn('updateShotSettings failed', e));
  };

  return (
    <div class="settings-section-stack">
      {/* Gate on the value, NOT on `loading`. A post-commit refetch flips
          `loading` true while keeping the last value, so gating on `loading`
          would drop the whole section to the fallback on every slider step
          (a visible "refresh"/remount). `settings()` retains its value across
          a refetch, so the section stays mounted; the loading copy only shows
          on the initial load (value still undefined) and the error copy when
          a fetch resolves to null. */}
      <Show
        when={settings()}
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
                Defaults for steaming milk. Temperature and duration set the
                auto-stop target; flow controls how fast steam leaves the wand
                (lower gives finer control of milk texture). A duration of 0
                means steam runs until you stop it.
              </p>

              {/* Temperature + duration come from shotSettings (WS-only). They
                  need a live snapshot to build the full POST body, so they
                  render once the stream has pushed a frame. */}
              <Show
                when={shot()}
                fallback={
                  <p
                    class="settings-help"
                    data-testid="machine-steam-shotsettings-pending"
                  >
                    Connect to the machine to set steam temperature and
                    duration.
                  </p>
                }
              >
                {(sh) => (
                  <>
                    <div class="settings-field settings-field--stack">
                      <label
                        class="settings-field__label"
                        for="machine-steam-temp"
                      >
                        Steam temperature
                      </label>
                      <DebouncedSliderField
                        testId="machine-steam-temp"
                        value={sh().targetSteamTemp}
                        onCommit={(targetSteamTemp) =>
                          commitShot({ targetSteamTemp })
                        }
                        min={130}
                        max={170}
                        step={1}
                        ariaLabel="Steam temperature in degrees Celsius"
                        formatValue={(v) => `${v.toFixed(0)} °C`}
                      />
                    </div>
                    <div class="settings-field settings-field--stack">
                      <label
                        class="settings-field__label"
                        for="machine-steam-duration"
                      >
                        Steam duration
                      </label>
                      <DebouncedSliderField
                        testId="machine-steam-duration"
                        value={sh().targetSteamDuration}
                        onCommit={(targetSteamDuration) =>
                          commitShot({ targetSteamDuration })
                        }
                        min={0}
                        max={120}
                        step={1}
                        ariaLabel="Steam duration in seconds"
                        formatValue={(v) =>
                          v <= 0 ? 'Until stopped' : `${v.toFixed(0)} s`
                        }
                      />
                    </div>
                  </>
                )}
              </Show>

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
