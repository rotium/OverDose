import type { OperationType, PrepType, StepType } from './operations';

/**
 * Per-Step configuration. Each Step type has its own shape — see
 * [[starter-skin-vocabulary]]. All fields are optional at every layer
 * (Beverage default, Recipe override, run-time override) so unset values
 * cascade through the resolution chain.
 *
 * `auto purge` is *not* a Step on its own — it's a SteamConfig field
 * (`autoPurgeTimeSec`) because it's only meaningful after steaming and its
 * delay is a personal preference at the beverage level. Missing/0 means
 * manual purge.
 */
export interface BrewConfig {
  durationSec?: number;
  targetYieldGrams?: number;
  stopAtWeight?: boolean;
}
export interface SteamConfig {
  durationSec?: number;
  smartSteam?: boolean;
  /** Auto-purge delay in seconds after steam. Missing/0 = manual purge. */
  autoPurgeTimeSec?: number;
}
export interface WaterConfig {
  volumeMl?: number;
}
export interface FlushConfig {
  durationSec?: number;
}
export interface WeightConfig {
  targetGrams?: number;
}
export interface BeanSelectionConfig {
  beanId?: string;
}
export interface ProfileSelectionConfig {
  profileId?: string;
}
export interface GrindConfig {
  grinderId?: string;
  grinderSetting?: number;
}

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
  weight: WeightConfig;
  'bean-selection': BeanSelectionConfig;
  'profile-selection': ProfileSelectionConfig;
  grind: GrindConfig;
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
  | { type: 'flush'; config: FlushConfig }
  | { type: 'weight'; config: WeightConfig }
  | { type: 'bean-selection'; config: BeanSelectionConfig }
  | { type: 'profile-selection'; config: ProfileSelectionConfig }
  | { type: 'grind'; config: GrindConfig };

export type StepOfType<T extends StepType> = Extract<Step, { type: T }>;
export type OperationStep = StepOfType<OperationType>;
export type PrepStep = StepOfType<PrepType>;
