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

/**
 * Display unit for the water-tank level. Reaprime streams `currentLevel` in
 * mm; the skin defaults to converting to mL for the user-facing readout.
 * `both` shows mL with a small mm secondary.
 */
export type WaterUnit = 'mL' | 'mm' | 'both';
export const DEFAULT_WATER_UNIT: WaterUnit = 'mL';

/**
 * Whether a scale is part of the setup. Default true. When false, the skin
 * hides scale UI (the header status pill, the dashboard scale readout) so a
 * scaleless user isn't shown a permanently-offline badge.
 */
export const DEFAULT_HAS_SCALE = true;

/**
 * Developer console/debug logging. Default off. When on, key flow events
 * (machine state/activity transitions, steam duration changes, brew-step and
 * steam-stop events) are written to the console and an in-memory buffer
 * (Settings → App → Developer).
 */
export const DEFAULT_DEBUG_LOGGING = false;

/**
 * How the wand purge after a steam stop is triggered. The DE1 needs a stop
 * command to *also* drive the purge; on a two-tap machine (`steamPurgeMode=1`)
 * one stop only parks the wand and a second is needed to purge. We model the
 * choice as a skin strategy that also writes the firmware `steamPurgeMode`:
 *
 *  - `firmware`  — let the machine purge itself: write `steamPurgeMode=0`, so a
 *                  single stop both ends steam and runs the ~5 s purge. No dwell
 *                  control (firmware-fixed). Default — deterministic, no waiting.
 *  - `autoFlush` — write `steamPurgeMode=1` (machine parks on stop), then the
 *                  skin auto-fires the purge after `steamAutoFlushSec`. Gives a
 *                  configurable dwell to keep the wand in the milk before it
 *                  puffs.
 *  - `manual`    — write `steamPurgeMode=1`; the skin shows a Purge button and
 *                  the user fires the purge when ready.
 *
 * `autoFlush`/`manual` set the machine to two-tap, which ALSO makes the
 * physical steam button require two presses — surfaced in the Machine tab copy.
 */
export type SteamPurgeStrategy = 'firmware' | 'autoFlush' | 'manual';
export const DEFAULT_STEAM_PURGE_STRATEGY: SteamPurgeStrategy = 'firmware';

/** Dwell (seconds) the wand stays parked before `autoFlush` fires the purge. */
export const DEFAULT_STEAM_AUTO_FLUSH_SEC = 3;
