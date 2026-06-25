import { For, Show, type Accessor, type Component } from 'solid-js';
import {
  isScaleStatusFrame,
  type MachineSnapshot,
  type ScaleMessage,
  type ScaleSnapshot,
  type ShotSettingsSnapshot,
  type WaterLevelsSnapshot,
} from '../snapshot';
import { useUserPrefs } from '../UserPrefsContext';
import type { SteamStatus } from '../steamController';
import { mmToMl, waterPct, type WaterSeverity } from '../water';
import type { SteamMode, WaterUnit } from '../prefs';
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
 * source. The steam control is a 3-way mode toggle (Off / Auto / On) — it
 * invokes `onSteamMode(mode)` with the chosen mode and reflects `steamMode`.
 * The temperature value beside it shows the live boiler reading and the real
 * on/off state (the DE1 has no steam flag — steam is on at `targetSteamTemp
 * >= 130`), independent of the chosen mode.
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
  /** Chosen steam mode (drives which toggle segment is active). */
  steamMode: Accessor<SteamMode>;
  /** Invoked with the chosen mode when a toggle segment is tapped. */
  onSteamMode: (mode: SteamMode) => void;
  /** Intent-based steam status (Off / Heating / Ready / Idle + direction). */
  steamStatus: Accessor<SteamStatus>;
}

const STEAM_MODES: { mode: SteamMode; label: string }[] = [
  { mode: 'off', label: 'Off' },
  { mode: 'auto', label: 'Auto' },
  { mode: 'on', label: 'On' },
];

const STEAM_STATE_LABEL: Record<SteamStatus['state'], string> = {
  off: 'Off',
  heating: 'Heating',
  ready: 'Ready',
  idle: 'Idle',
};

export const StatusPanel: Component<StatusPanelProps> = (p) => {
  const prefs = useUserPrefs();
  const scaleData = () => dataFrame(p.scale());

  // The dot + arrow are visual; the temp is shown, but carry the state word
  // (which the dot replaces) for screen readers via the value's aria-label.
  const steamAria = (): string => {
    const s = p.steamStatus();
    const dir =
      s.direction === 'up'
        ? ', warming up'
        : s.direction === 'down'
          ? ', cooling down'
          : '';
    return `Steam ${STEAM_STATE_LABEL[s.state]}${dir}, ${fmtTemp(p.machine()?.steamTemperature, 0)}`;
  };

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
          {/* Intent-based status (Off / Heating / Ready / Idle) with a
              direction arrow (↑ warming, ↓ cooling) and the live temp. The
              mode toggle beside it sets the chosen mode. */}
          <span
            class="status__steam-value"
            data-testid="status-steam-temp"
            data-state={p.steamStatus().state}
            aria-label={steamAria()}
          >
            <span class="status__steam-dot" aria-hidden="true" />
            <Show when={p.steamStatus().direction}>
              {(dir) => (
                <span
                  class="status__steam-dir"
                  data-dir={dir()}
                  aria-hidden="true"
                >
                  {dir() === 'up' ? '↑' : '↓'}
                </span>
              )}
            </Show>
            <span class="status__steam-now" aria-hidden="true">
              {fmtTemp(p.machine()?.steamTemperature, 0)}
            </span>
          </span>
          <div
            class="status__steam-modes"
            role="radiogroup"
            aria-label="Steam mode"
            data-testid="status-steam-modes"
          >
            <For each={STEAM_MODES}>
              {(m) => (
                <button
                  type="button"
                  role="radio"
                  data-testid={`steam-mode-${m.mode}`}
                  data-on={
                    p.steamMode() === m.mode
                      ? m.mode === 'off'
                        ? 'off'
                        : 'on'
                      : undefined
                  }
                  aria-label={`Steam ${m.label}`}
                  aria-checked={p.steamMode() === m.mode}
                  disabled={p.shotSettings() === null}
                  onClick={() => p.onSteamMode(m.mode)}
                >
                  {m.label}
                </button>
              )}
            </For>
          </div>
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
