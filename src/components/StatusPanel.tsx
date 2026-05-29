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
import { mmToMl, waterPct, waterSeverity } from '../water';
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
  const prefs = useUserPrefs();
  const steamOn = () => (p.shotSettings()?.steamSetting ?? 0) > 0;
  const scaleData = () => dataFrame(p.scale());
  const sev = (mm: number) =>
    waterSeverity(mm, prefs.waterWarnMm(), prefs.waterBlockMm());

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

        <dt data-severity={p.waterLevels() ? sev(p.waterLevels()!.currentLevel) : 'normal'}>
          <WaterDropIcon size={16} />
          <span>Water</span>
        </dt>
        <dd
          data-testid="status-water"
          data-severity={p.waterLevels() ? sev(p.waterLevels()!.currentLevel) : 'normal'}
        >
          <Show when={p.waterLevels()} fallback={<span class="muted">—</span>}>
            {(w) => {
              // Getter, not const — Solid only re-runs this function-child
              // when the outer Show's truthy/falsy flips, so capturing the
              // severity value once would stick at its first-seen state
              // (bug: banner stayed visible after refilling past critical).
              const rowSev = () => sev(w().currentLevel);
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
