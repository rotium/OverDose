import type { StepType } from './operations';

/**
 * Per-Step configuration.
 *
 * Beverage-level config carries shared preferences for a drink as a whole.
 * Brew, steam and flush still keep their tunables on Recipe metadata +
 * Profile + run-time defaults, so their interfaces stay empty and nominal —
 * the resolution chain can layer fields in later without breaking call-sites.
 *
 * `WaterConfig` is the first to carry real fields, and deliberately so: unlike
 * steam (one pitcher per recipe, hence the flat `Recipe.pitcherId`), a single
 * recipe can pour water twice at different settings — pre-warm the cup with
 * 80 mL at 95 °C, brew, then dilute with 150 mL at 85 °C. That needs the
 * config on the *step*, reached through `Recipe.overrides[stepId]`.
 */
export interface BrewConfig {}
export interface SteamConfig {}
export interface WaterConfig {
  /** Vessel to pour into — references `Vessel.id` from the Hot Water library.
   *  Supplies the flow and the ceiling for `volumeMl`. Unset → the prep screen
   *  starts unpicked and the user taps one. */
  vesselId?: string;
  /** How much to dispense (mL ≈ g). Clamped to the vessel's `capacityMl`.
   *  Unset → falls back to the chosen vessel's capacity. */
  volumeMl?: number;
  /** Target hot-water temperature (°C). Unset → the global default pref.
   *  On the step rather than the vessel: a mug is a mug whether it's holding
   *  an americano at 85 °C or green tea at 80 °C. */
  tempC?: number;
}
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
