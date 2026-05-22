import { Show, type Accessor, type Component } from 'solid-js';
import {
  isScaleStatusFrame,
  type MachineSnapshot,
  type ScaleMessage,
  type ScaleSnapshot,
  type ShotSettingsSnapshot,
  type WaterLevelsSnapshot,
} from '../snapshot';

/**
 * Visualization-only cap for the water-level bar. Reaprime reports `currentLevel`
 * in mm (not %), and the tank max varies by machine — we hard-code a soft cap so
 * the bar has a stable visual scale. Refine when we expose a per-machine setting.
 */
const WATER_BAR_MAX_MM = 200;

const fmtTemp = (t: number | null | undefined, digits = 1) =>
  t == null ? '—' : `${t.toFixed(digits)} °C`;

const fmtWeight = (w: number | null | undefined) =>
  w == null ? '—' : `${w.toFixed(1)} g`;

const waterPct = (mm: number) =>
  Math.max(0, Math.min(1, mm / WATER_BAR_MAX_MM));

const dataFrame = (msg: ScaleMessage | null): ScaleSnapshot | null =>
  msg && !isScaleStatusFrame(msg) ? msg : null;

/**
 * StatusPanel — right-column dashboard for the Home screen. Renders machine
 * state, group/steam temps, water level, scale, and a steam on/off toggle.
 *
 * All inputs are signals so the panel reacts at the granularity of the data
 * source. Steam toggle invokes `onSteamToggle(nextOn)` with the desired state
 * — the parent decides how to POST to the gateway (typically by composing the
 * current `ShotSettingsSnapshot` and overwriting `steamSetting`).
 */
export interface StatusPanelProps {
  machine: Accessor<MachineSnapshot | null>;
  scale: Accessor<ScaleMessage | null>;
  shotSettings: Accessor<ShotSettingsSnapshot | null>;
  waterLevels: Accessor<WaterLevelsSnapshot | null>;
  onSteamToggle: (next: boolean) => void;
}

export const StatusPanel: Component<StatusPanelProps> = (p) => {
  const steamOn = () => (p.shotSettings()?.steamSetting ?? 0) > 0;
  const scaleData = () => dataFrame(p.scale());

  return (
    <section class="card status">
      <h2>Status</h2>

      <dl class="status__grid">
        <dt>State</dt>
        <dd data-testid="status-state">
          <Show when={p.machine()} fallback="—">
            {(s) => <>{s().state.state}</>}
          </Show>
        </dd>

        <dt>Group</dt>
        <dd data-testid="status-group-temp">
          {fmtTemp(p.machine()?.groupTemperature)}
        </dd>

        <dt>Steam</dt>
        <dd class="status__row">
          <span data-testid="status-steam-temp">
            {fmtTemp(p.machine()?.steamTemperature, 0)}
          </span>
          <button
            type="button"
            class="toggle"
            data-on={steamOn()}
            aria-label="Toggle steam heater"
            aria-pressed={steamOn()}
            disabled={p.shotSettings() === null}
            onClick={() => p.onSteamToggle(!steamOn())}
          >
            {steamOn() ? 'on' : 'off'}
          </button>
        </dd>

        <dt>Water</dt>
        <dd data-testid="status-water">
          <Show when={p.waterLevels()} fallback={<span class="muted">—</span>}>
            {(w) => (
              <span class="status__row">
                <span>{w().currentLevel.toFixed(0)} mm</span>
                <span class="bar" aria-hidden="true">
                  <span
                    class="bar__fill"
                    style={{ width: `${waterPct(w().currentLevel) * 100}%` }}
                  />
                </span>
              </span>
            )}
          </Show>
        </dd>

        <dt>Scale</dt>
        <dd data-testid="status-scale">
          {fmtWeight(scaleData()?.weight)}
          <Show when={scaleData()?.batteryLevel != null}>
            <span class="muted"> · {scaleData()!.batteryLevel}%</span>
          </Show>
        </dd>
      </dl>
    </section>
  );
};
