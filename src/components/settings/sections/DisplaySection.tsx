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
  { key: 'steps', label: 'Step boundaries' },
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

      <section class="settings-section" aria-labelledby="display-liveop-heading">
        <h2 id="display-liveop-heading">Live operation views</h2>
        <label class="settings-checkbox">
          <input
            type="checkbox"
            data-testid="pref-show-steam-flow-slider"
            checked={prefs.showSteamFlowSlider()}
            onChange={(e) =>
              prefs.setShowSteamFlowSlider(e.currentTarget.checked)
            }
          />
          <span>Show steam-flow control during steaming</span>
        </label>
        <label class="settings-checkbox">
          <input
            type="checkbox"
            data-testid="pref-show-water-flow-slider"
            checked={prefs.showWaterFlowSlider()}
            onChange={(e) =>
              prefs.setShowWaterFlowSlider(e.currentTarget.checked)
            }
          />
          <span>Show flow slider during hot water</span>
        </label>
        <label class="settings-checkbox">
          <input
            type="checkbox"
            data-testid="pref-show-flush-flow-slider"
            checked={prefs.showFlushFlowSlider()}
            onChange={(e) =>
              prefs.setShowFlushFlowSlider(e.currentTarget.checked)
            }
          />
          <span>Show flow slider during flush</span>
        </label>
        <p class="settings-help">
          The current flow value always shows in the live view regardless.
          Enable these to also expose a slider that lets you tune the flow
          mid-operation (mirrors Decent.app's own screens).
        </p>
      </section>

      <section class="settings-section" aria-labelledby="display-scale-heading">
        <h2 id="display-scale-heading">Scale</h2>
        <label class="settings-checkbox">
          <input
            type="checkbox"
            data-testid="pref-has-scale"
            checked={prefs.hasScale()}
            onChange={(e) => prefs.setHasScale(e.currentTarget.checked)}
          />
          <span>I have a scale connected to the machine</span>
        </label>
        <p class="settings-help">
          Turn this off if you don't use a scale — the scale status pill and
          the dashboard weight readout are hidden instead of showing a
          permanently-offline scale.
        </p>
      </section>
    </div>
  );
};
