import type { Component } from 'solid-js';
import { useUserPrefs } from '../../../UserPrefsContext';
import { WATER_TANK_MAX_MM } from '../../../water';

const parseMm = (raw: string, fallback: number): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
};

/**
 * Alerts subsection — when the skin warns or blocks the user. Today this is
 * just water-tank thresholds. Critical is clamped so it never exceeds warn
 * (an inverted pair would make the alert UI render nonsense) and warn is
 * clamped so it never drops below critical.
 */
export const AlertsSection: Component = () => {
  const prefs = useUserPrefs();

  const setWarn = (raw: string) => {
    const parsed = parseMm(raw, prefs.waterWarnMm());
    const clamped = Math.max(
      prefs.waterBlockMm(),
      Math.min(WATER_TANK_MAX_MM, parsed),
    );
    prefs.setWaterWarnMm(clamped);
  };

  const setBlock = (raw: string) => {
    const parsed = parseMm(raw, prefs.waterBlockMm());
    const clamped = Math.max(0, Math.min(prefs.waterWarnMm(), parsed));
    prefs.setWaterBlockMm(clamped);
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
              min="0"
              max={WATER_TANK_MAX_MM}
              step="1"
              value={prefs.waterWarnMm()}
              onChange={(e) => setWarn(e.currentTarget.value)}
            />
            <span class="settings-unit">mm</span>
          </div>
        </div>
        <div class="settings-field">
          <label class="settings-field__label" for="block-threshold">
            Critical threshold
          </label>
          <div class="settings-number-row">
            <input
              id="block-threshold"
              type="number"
              min="0"
              max={prefs.waterWarnMm()}
              step="1"
              value={prefs.waterBlockMm()}
              onChange={(e) => setBlock(e.currentTarget.value)}
            />
            <span class="settings-unit">mm</span>
          </div>
        </div>
        <p class="settings-help">
          Critical is capped at the warn threshold — brewing is blocked when
          the tank drops to this level.
        </p>
      </section>
    </div>
  );
};
