import type { StepType } from './operations';

/**
 * Per-Step configuration.
 *
 * Beverage-level config carries shared preferences for a drink as a whole.
 * Today none of the four step types has a Beverage-level field — their
 * tunables live on Recipe metadata + Profile + run-time defaults. The
 * types stay nominal (one interface per step) so the resolution chain
 * can layer additional fields without breaking call-sites.
 */
export interface BrewConfig {}
export interface SteamConfig {}
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
