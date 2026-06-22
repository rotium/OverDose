import { Show, type Accessor, type Component } from 'solid-js';
import {
  isScaleStatusFrame,
  type MachineSnapshot,
  type ScaleMessage,
  type ScaleSnapshot,
  type ShotSettingsSnapshot,
  type WaterLevelsSnapshot,
} from '../snapshot';
import { useUserPrefs } from '../UserPrefsContext';
import { isSteamOn } from '../steam';
import { mmToMl, waterPct, type WaterSeverity } from '../water';
import type { WaterUnit } from '../prefs';
import {
  PowerIcon,
  ScaleIcon,
  SteamIcon,
  ThermometerIcon,
  WaterDropIcon,
} from './icons';

const WATER_ALERT_TEXT = {
  critical: 'Refill water tank',
};

const fmtTemp = (t: number | null | undefined, digits = 1) =>
  t == null ? '—' : `${t.toFixed(digits)} °C`;

const fmtWeight = (w: number | null | undefined) =>
  w == null ? '—' : `${w.toFixed(1)} g`;

const dataFrame = (msg: ScaleMessage | null): ScaleSnapshot | null =>
  msg && !isScaleStatusFrame(msg) ? msg : null;

const formatWaterLevel = (mm: number, unit: WaterUnit): string => {
  const mlPart = `${Math.round(mmToMl(mm))} mL`;
  const mmPart = `${mm.toFixed(0)} mm`;
  switch (unit) {
    case 'mL':
      return mlPart;
    case 'mm':
      return mmPart;
    case 'both':
      return `${mlPart} · ${mmPart}`;
  }
};

/**
 * StatusPanel — right-column dashboard for the Home screen. Renders machine
 * state, group/steam temps, water level, scale, and a steam on/off toggle.
 *
 * All inputs are signals so the panel reacts at the granularity of the data
 * source. Steam toggle invokes `onSteamToggle(nextOn)` with the desired state —
 * the parent composes the `ShotSettingsSnapshot` and sets `targetSteamTemp`
 * (the desired temp to enable, 0 to disable; the DE1 has no separate steam flag,
 * so steam is on when `targetSteamTemp >= 130`).
 */
export interface StatusPanelProps {
  machine: Accessor<MachineSnapshot | null>;
  scale: Accessor<ScaleMessage | null>;
  shotSettings: Accessor<ShotSettingsSnapshot | null>;
  waterLevels: Accessor<WaterLevelsSnapshot | null>;
  /**
   * Committed (hysteretic) water severity — shared app-wide source. Drives the
   * row color and the critical banner. `waterLevels` is still used for the raw
   * numeric/bar readouts.
   */
  waterSeverity: Accessor<WaterSeverity>;
  onSteamToggle: (next: boolean) => void;
}

export const StatusPanel: Component<StatusPanelProps> = (p) => {
  const prefs = useUserPrefs();
  // The DE1 has no "steam enabled" flag — steam is on when the machine's target
  // steam temp is at/above the firmware threshold, off at 0.
  const steamOn = () => isSteamOn(p.shotSettings());
  const scaleData = () => dataFrame(p.scale());

  return (
    <section class="card status">
      <h2>Status</h2>

      <dl class="status__grid">
        <dt>
          <PowerIcon size={16} />
          <span>State</span>
        </dt>
        <dd data-testid="status-state">
          <Show when={p.machine()} fallback="—">
            {(s) => <>{s().state.state}</>}
          </Show>
        </dd>

        <dt>
          <ThermometerIcon size={16} />
          <span>Group</span>
        </dt>
        <dd data-testid="status-group-temp">
          {fmtTemp(p.machine()?.groupTemperature)}
        </dd>

        <dt>
          <SteamIcon size={16} />
          <span>Steam</span>
        </dt>
        <dd class="status__row">
          {/* Off is the notable state (the heater is meant to be on to steam),
              so flag it on the value; the switch shows the real state. */}
          <span
            class="status__steam-value"
            data-testid="status-steam-temp"
            data-on={steamOn() ? 'true' : 'false'}
          >
            {/* DEBUG (revert): show the live boiler temp even when off, to
                validate the off switch and watch heat-up time. */}
            {steamOn()
              ? fmtTemp(p.machine()?.steamTemperature, 0)
              : `Off · ${fmtTemp(p.machine()?.steamTemperature, 0)}`}
          </span>
          <button
            type="button"
            class="switch"
            role="switch"
            data-on={steamOn() ? 'true' : undefined}
            aria-label="Toggle steam heater"
            aria-checked={steamOn()}
            disabled={p.shotSettings() === null}
            onClick={() => p.onSteamToggle(!steamOn())}
          />
        </dd>

        <dt data-severity={p.waterSeverity()}>
          <WaterDropIcon size={16} />
          <span>Water</span>
        </dt>
        <dd
          data-testid="status-water"
          data-severity={p.waterSeverity()}
        >
          <Show when={p.waterLevels()} fallback={<span class="muted">—</span>}>
            {(w) => {
              // Getter, not const — Solid only re-runs this function-child when
              // the outer Show's truthy/falsy flips, so reading the severity
              // accessor through a getter keeps it reactive (capturing the
              // value once would stick at its first-seen state).
              const rowSev = p.waterSeverity;
              return (
                <span class="status__row status__row--wrap">
                  <span>{formatWaterLevel(w().currentLevel, prefs.waterUnit())}</span>
                  <span class="bar" aria-hidden="true">
                    <span
                      class="bar__fill"
                      data-severity={rowSev()}
                      style={{ width: `${waterPct(w().currentLevel) * 100}%` }}
                    />
                  </span>
                  <Show when={rowSev() === 'critical'}>
                    <span
                      class="status__water-banner"
                      role="status"
                      data-testid="status-water-alert"
                    >
                      <WaterDropIcon size={14} />
                      <span>{WATER_ALERT_TEXT.critical}</span>
                    </span>
                  </Show>
                </span>
              );
            }}
          </Show>
        </dd>

        <Show when={prefs.hasScale()}>
          <dt>
            <ScaleIcon size={16} />
            <span>Scale</span>
          </dt>
          <dd data-testid="status-scale">
            {fmtWeight(scaleData()?.weight)}
            <Show when={scaleData()?.batteryLevel != null}>
              <span class="muted"> · {scaleData()!.batteryLevel}%</span>
            </Show>
          </dd>
        </Show>
      </dl>
    </section>
  );
};
