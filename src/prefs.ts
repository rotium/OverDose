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

import type { LogLevel } from './debugLog';

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
  /** Vertical profile step-boundary lines on the chart. */
  steps: boolean;
}

export type TraceKey = keyof TraceVisibility;

export const DEFAULT_TRACE_VISIBILITY: TraceVisibility = {
  pressure: true,
  flow: true,
  weightFlow: true,
  weight: true,
  mixTemp: true,
  targets: true,
  steps: true,
};

/**
 * Display unit for the water-tank level. Reaprime streams `currentLevel` in
 * mm; the skin defaults to converting to mL for the user-facing readout.
 * `both` shows mL with a small mm secondary.
 */
export type WaterUnit = 'mL' | 'mm' | 'both';
export const DEFAULT_WATER_UNIT: WaterUnit = 'mL';

/**
 * TEMPORARY (2026-07 debug toggle): whether to add the DE1 intake-tube offset
 * (~5mm) to the displayed water level before converting to mm/mL/fill. The DE1
 * measures from the intake tube, which sits above the true tank bottom; DE1App
 * adds this back, reaprime forwards the raw value. Default on so the readout
 * matches the real tank / DE1App. Kept as a pref only to feel out both modes on
 * hardware — likely to become fixed behaviour later. See WATER_INTAKE_OFFSET_MM.
 */
export const DEFAULT_WATER_INTAKE_OFFSET = true;

/**
 * Whether a scale is part of the setup. Default true. When false, the skin
 * hides scale UI (the header status pill, the dashboard scale readout) so a
 * scaleless user isn't shown a permanently-offline badge.
 */
export const DEFAULT_HAS_SCALE = true;

/**
 * Desired steam-boiler target temperature (°C) — OverDose owns this value (the
 * skin's "memory"). The DE1 has no "steam enabled" flag: steam is on when the
 * machine's `targetSteamTemp >= 130` and off when it's 0, so turning steam off
 * zeroes the machine value and would otherwise lose the configured temperature.
 * We keep the desired here, push it to the machine on enable (and re-assert it
 * on focus), and only read the on/off *state* back from the machine. Default to
 * the DE1 steam ceiling; the editor clamps to 130–170 (see SteamSection).
 */
export const DEFAULT_STEAM_TARGET_TEMP = 170;
export const STEAM_TEMP_MIN = 130;
export const STEAM_TEMP_MAX = 170;

/**
 * Steam mode — how the steam boiler is governed, chosen from the Home steam
 * toggle:
 *  - `off`  — heater off (`targetSteamTemp = 0`); steam prep still opens but
 *             its Start is an inline "turn on steam".
 *  - `on`   — held at the desired steam temp whenever the machine is awake.
 *  - `auto` — app-managed warm-on-demand + auto-off, configured in Settings
 *             (flavour / idle temp / timeout).
 * On/Off are wired first; Auto's runtime behaviour is a later phase, so for
 * now selecting Auto only records the preference (no steam write).
 */
export type SteamMode = 'off' | 'auto' | 'on';
export const DEFAULT_STEAM_MODE: SteamMode = 'on';

/**
 * Auto-mode flavour — what triggers the boiler to warm up:
 *  - `eco`   — warm on any machine activity (brew/flush/water, tablet), like
 *              the Decent app's Eco-Steam. Most likely to be ready; more idle
 *              power.
 *  - `smart` — warm only when a steam recipe / Explore → Steam is opened.
 *              Saves the most power.
 */
export type SteamAutoFlavor = 'eco' | 'smart';
export const DEFAULT_STEAM_AUTO_FLAVOR: SteamAutoFlavor = 'smart';

/**
 * What steam falls back to when Auto goes idle. `0` = fully off (cold; biggest
 * saving, slowest reheat); any value `>= STEAM_IDLE_TEMP_MIN` is a warm hold
 * (a lower hold than the steam-on threshold still cuts reheat time). The
 * settings UI presents this as Off vs. a temperature. Default Off.
 */
export const DEFAULT_STEAM_IDLE_TEMP = 0;
/** Lowest warm-hold temperature; below this, idle is treated as Off. */
export const STEAM_IDLE_TEMP_MIN = 50;
export const STEAM_IDLE_TEMP_MAX = STEAM_TEMP_MAX;
/** Temp used when the user switches idle to "keep warm" from Off. */
export const DEFAULT_STEAM_IDLE_WARM = 130;

/**
 * Minutes before Auto drops the boiler to the idle temperature — counted from
 * inactivity (Eco) or last steam use / steam-recipe close (Smart). Default 10
 * (matches the Decent app's Eco-Steam).
 */
export const DEFAULT_STEAM_AUTO_TIMEOUT_MIN = 10;
export const STEAM_AUTO_TIMEOUT_MIN_MIN = 1;
export const STEAM_AUTO_TIMEOUT_MIN_MAX = 60;

/**
 * Developer log verbosity. Default `info`: error/warn/info always emit (so a
 * real gateway always captures the session narrative for post-hoc debugging),
 * while the chattier debug/trace levels stay off until a developer raises the
 * level in Settings → About → Developer. See `debugLog.ts` for the level model.
 */
export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

/** Play a short audio cue when the machine goes to sleep / wakes. Default on. */
export const DEFAULT_SOUND_CUES = true;

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

/**
 * How a shot decides to auto-stop. The gateway only ever stops on weight
 * (with a scale) or volume (without one); this preference picks which target
 * OverDose sends, so the *intent* is explicit instead of implied:
 *
 *  - `auto`   — today's behavior: send both, let the gateway pick (scale →
 *               weight, no scale → volume). The safe default.
 *  - `weight` — stop at the target yield (needs a scale; otherwise won't stop).
 *  - `volume` — stop at the target volume (only takes effect with no scale —
 *               the gateway ignores volume while a scale is connected).
 *  - `off`    — never auto-stop; the shot ends on the profile's own steps or
 *               a manual stop.
 *
 * This is the global default; it can be overridden per shot in the prep card,
 * where only the modes that can actually fire (given the live scale state) are
 * offered. See `src/autoStop.ts` for the logic.
 */
export type AutoStopMode = 'auto' | 'weight' | 'volume' | 'off';
export const DEFAULT_AUTO_STOP_MODE: AutoStopMode = 'auto';
