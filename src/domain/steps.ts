import type { StepType } from './operations';

/**
 * Per-Step configuration.
 *
 * At the **Beverage level** today, only the steam step has any tunable
 * parameters — its post-steam purge behaviour. Brew / Water / Flush carry
 * no Beverage-level fields (their durations and yields are driven by
 * Recipe metadata + Profile + run-time defaults, not Beverage shared
 * preferences). Recipe and run-time override layers may extend these in
 * the future; the types stay nominal so the resolution chain can layer
 * additional fields without breaking call-sites.
 *
 * `autoPurgeTimeSec`:
 *   - `undefined` (or 0) → **Manual purge**: the user presses the purge
 *     button on the machine after steaming.
 *   - `> 0` → **Auto purge**: the machine flushes the group head this
 *     many seconds after steam ends.
 */
export interface BrewConfig {}
export interface SteamConfig {
  /** Auto-purge delay in seconds after steam. Missing/0 = manual purge. */
  autoPurgeTimeSec?: number;
}
export interface WaterConfig {}
export interface FlushConfig {}

/**
 * Type-level map from StepType → config shape. Used by Recipe overrides
 * (keyed by Step id, runtime-narrowed against the matching BeverageStep's
 * type) and by editor components that need to render the right form per
 * step type.
 */
export interface StepConfigByType {
  brew: BrewConfig;
  steam: SteamConfig;
  water: WaterConfig;
  flush: FlushConfig;
}

/** Union of every step's config shape — useful for storage typing. */
export type AnyStepConfig = StepConfigByType[StepType];

/**
 * Discriminated union of (type, config) pairs. Used for in-memory editing
 * and as the building block for BeverageStep (which adds a stable `id`).
 */
export type Step =
  | { type: 'brew'; config: BrewConfig }
  | { type: 'steam'; config: SteamConfig }
  | { type: 'water'; config: WaterConfig }
  | { type: 'flush'; config: FlushConfig };

export type StepOfType<T extends StepType> = Extract<Step, { type: T }>;
