/**
 * User-tunable display preferences. Today these are compile-time constants
 * threaded through component props; once a Settings screen lands they'll
 * live in a UserPrefsContext (or a persisted store) and the same prop
 * surface stays — just the source changes.
 *
 * Keep this module side-effect-free: types + defaults only. The actual
 * wiring to React/Solid state belongs in a UserPrefsContext that we'll
 * add when the config screen exists.
 */

/**
 * Line smoothing for the live brew chart. Trade-offs:
 *   - `linear`   — straight segments between samples; sharp corners at
 *                  every data point. Most faithful to the underlying data.
 *   - `rounded`  — same geometry as linear, but with round line caps/joins
 *                  so corners render as small arcs. Slightly softer look
 *                  without modifying the data path. Matches fl_chart's
 *                  default appearance (the gateway).
 *   - `spline`   — cubic spline interpolation through every sample. Very
 *                  smooth, but invents path between samples — can mask
 *                  micro-variations and slightly over/undershoot at sharp
 *                  transitions.
 */
export type ChartSmoothing = 'linear' | 'rounded' | 'spline';

export const DEFAULT_CHART_SMOOTHING: ChartSmoothing = 'rounded';

/**
 * Per-trace visibility for the live brew chart, toggled by clicking the
 * legend. All-visible by default; the user can hide noise (e.g. mix-temp)
 * to focus on pressure/flow.
 *
 * `targets` is a single flag for all three dashed target traces — toggling
 * pressure-target and flow-target independently isn't a feature anyone
 * has asked for, so they ride together.
 */
export interface TraceVisibility {
  pressure: boolean;
  flow: boolean;
  weightFlow: boolean;
  weight: boolean;
  mixTemp: boolean;
  targets: boolean;
}

export type TraceKey = keyof TraceVisibility;

export const DEFAULT_TRACE_VISIBILITY: TraceVisibility = {
  pressure: true,
  flow: true,
  weightFlow: true,
  weight: true,
  mixTemp: true,
  targets: true,
};
