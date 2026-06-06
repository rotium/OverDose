import { Show, type Accessor, type Component } from 'solid-js';
import { useUserPrefs } from '../../../UserPrefsContext';
import { WATER_TANK_MAX_MM } from '../../../water';
import { api } from '../../../api';
import type { WaterLevelsSnapshot } from '../../../snapshot';
import { DebouncedNumberField } from './library/DebouncedNumberField';

const parseMm = (raw: string, fallback: number): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
};

export interface AlertsSectionProps {
  /** Live water-levels accessor — supplies the machine's current refill
   *  (critical) threshold, which the Critical field reads and writes. When
   *  absent (no machine / tests) the Critical field shows "—" and is hidden. */
  waterLevels?: Accessor<WaterLevelsSnapshot | null>;
  /** Writes the machine's refill threshold (mm). Defaults to the gateway POST.
   *  Injected so tests can capture the write without hitting the network. */
  onSetRefillLevel?: (mm: number) => void;
}

/**
 * Alerts subsection — when the skin warns or blocks on low water.
 *
 * Two levels, two owners:
 *  - **Warn** is a skin-only visual heads-up — a UserPrefs value, tuned here.
 *  - **Critical** is NOT a skin value: it IS the machine's refill level
 *    (`refillLevel`, from the water stream). Editing it writes through to the
 *    DE1 via `api.setRefillLevel`, and the displayed value reads back from the
 *    machine — so the skin's critical alert and the machine stay in sync.
 *
 * Warn is clamped to sit at/above the machine's critical level; critical is
 * clamped at/below warn, so the pair never inverts.
 */
export const AlertsSection: Component<AlertsSectionProps> = (p) => {
  const prefs = useUserPrefs();

  const refillMm = (): number | null => p.waterLevels?.()?.refillLevel ?? null;
  const writeRefill =
    p.onSetRefillLevel ??
    ((mm: number) =>
      void api
        .setRefillLevel(mm)
        .catch((e) => console.warn('set refill level failed', e)));

  // Warn floor = the machine's critical level (skin warns no later than the
  // machine's hard stop). Falls back to 0 when no machine has reported one.
  const setWarn = (raw: string) => {
    const floor = refillMm() ?? 0;
    const parsed = parseMm(raw, prefs.waterWarnMm());
    prefs.setWaterWarnMm(Math.max(floor, Math.min(WATER_TANK_MAX_MM, parsed)));
  };

  // Critical writes the machine's refill level (clamped at/below warn). Ignores
  // a cleared field — there's no "no critical level" on the machine.
  const commitCritical = (v: number | undefined) => {
    if (v === undefined) return;
    writeRefill(Math.max(0, Math.min(prefs.waterWarnMm(), v)));
  };

  return (
    <div class="settings-section-stack">
      <section class="settings-section" aria-labelledby="alerts-water-heading">
        <h2 id="alerts-water-heading">Water</h2>
        <div class="settings-field">
          <label class="settings-field__label" for="warn-threshold">
            Warn threshold
          </label>
          <div class="settings-number-row">
            <input
              id="warn-threshold"
              type="number"
              min={refillMm() ?? 0}
              max={WATER_TANK_MAX_MM}
              step="1"
              value={prefs.waterWarnMm()}
              onChange={(e) => setWarn(e.currentTarget.value)}
            />
            <span class="settings-unit">mm</span>
          </div>
        </div>
        <div class="settings-field">
          <label class="settings-field__label">Critical threshold</label>
          <div class="settings-number-row">
            <Show
              when={refillMm() !== null}
              fallback={
                <span class="settings-unit" data-testid="critical-no-machine">
                  — (no machine connected)
                </span>
              }
            >
              {/* Bound to the live machine refill level — must use the
                  debounced field so incoming water frames don't reset the
                  input mid-type. Commit writes through to the machine. */}
              <DebouncedNumberField
                value={refillMm() ?? undefined}
                onCommit={commitCritical}
                min={0}
                step={1}
                ariaLabel="Critical threshold"
                testId="critical-threshold"
              />
              <span class="settings-unit">mm</span>
            </Show>
          </div>
        </div>
        <p class="settings-help">
          Warn is a skin-only heads-up. Critical is the machine's refill
          level — editing it updates the machine, and brewing is blocked once
          the tank drops to it.
        </p>
      </section>

      <section class="settings-section" aria-labelledby="alerts-sounds-heading">
        <h2 id="alerts-sounds-heading">Sounds</h2>
        <label class="settings-checkbox">
          <input
            type="checkbox"
            data-testid="pref-sound-cues"
            checked={prefs.soundCues()}
            onChange={(e) => prefs.setSoundCues(e.currentTarget.checked)}
          />
          <span>Play sound cues</span>
        </label>
        <p class="settings-help">
          A short cue when the machine goes to sleep, wakes up, finishes warming
          up and is ready to brew, or the water runs low. Uses the tablet's
          volume.
        </p>
      </section>
    </div>
  );
};
