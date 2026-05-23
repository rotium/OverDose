import { For, type Component } from 'solid-js';
import { useUserPrefs } from '../../../UserPrefsContext';
import type { ChartSmoothing, TraceVisibility, WaterUnit } from '../../../prefs';

const WATER_UNIT_OPTIONS: { value: WaterUnit; label: string }[] = [
  { value: 'mL', label: 'mL' },
  { value: 'mm', label: 'mm' },
  { value: 'both', label: 'Both' },
];

const SMOOTHING_OPTIONS: { value: ChartSmoothing; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'spline', label: 'Spline' },
];

const TRACE_OPTIONS: { key: keyof TraceVisibility; label: string }[] = [
  { key: 'pressure', label: 'Pressure' },
  { key: 'flow', label: 'Flow' },
  { key: 'weightFlow', label: 'Weight flow' },
  { key: 'weight', label: 'Weight' },
  { key: 'mixTemp', label: 'Mix temp' },
  { key: 'targets', label: 'Targets' },
];

/**
 * Display subsection — visual formatting choices. Groups three controls:
 * water-level unit (numeric formatting), chart smoothing (line style), and
 * default trace visibility (which series start on). All auto-save.
 */
export const DisplaySection: Component = () => {
  const prefs = useUserPrefs();

  return (
    <div class="settings-section-stack">
      <section class="settings-section" aria-labelledby="display-water-heading">
        <h2 id="display-water-heading">Water level unit</h2>
        <div class="settings-radio-row" role="radiogroup" aria-label="Water level unit">
          <For each={WATER_UNIT_OPTIONS}>
            {(opt) => (
              <label class="settings-radio">
                <input
                  type="radio"
                  name="water-unit"
                  value={opt.value}
                  checked={prefs.waterUnit() === opt.value}
                  onChange={() => prefs.setWaterUnit(opt.value)}
                />
                <span>{opt.label}</span>
              </label>
            )}
          </For>
        </div>
      </section>

      <section class="settings-section" aria-labelledby="display-chart-heading">
        <h2 id="display-chart-heading">Chart</h2>

        <div class="settings-field">
          <span class="settings-field__label">Smoothing</span>
          <div class="settings-radio-row" role="radiogroup" aria-label="Chart smoothing">
            <For each={SMOOTHING_OPTIONS}>
              {(opt) => (
                <label class="settings-radio">
                  <input
                    type="radio"
                    name="chart-smoothing"
                    value={opt.value}
                    checked={prefs.chartSmoothing() === opt.value}
                    onChange={() => prefs.setChartSmoothing(opt.value)}
                  />
                  <span>{opt.label}</span>
                </label>
              )}
            </For>
          </div>
        </div>

        <div class="settings-field settings-field--stack">
          <span class="settings-field__label">Default trace visibility</span>
          <div class="settings-checkbox-grid">
            <For each={TRACE_OPTIONS}>
              {(opt) => (
                <label class="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={prefs.traceVisibility()[opt.key]}
                    onChange={(e) =>
                      prefs.setTraceVisible(opt.key, e.currentTarget.checked)
                    }
                  />
                  <span>{opt.label}</span>
                </label>
              )}
            </For>
          </div>
        </div>
      </section>
    </div>
  );
};
