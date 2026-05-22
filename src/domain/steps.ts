import type { OperationType, PrepType, StepType } from './operations';

/**
 * Per-Step configuration. Each Step type has its own shape. A Step in a Workflow
 * is an (Operation/Prep type, config) pair — see [[starter-skin-vocabulary]].
 *
 * Optional fields are intentional: a Workflow can leave a value unset and prompt
 * at runtime, or set a default the user can override. Stop conditions for `brew`
 * live here (not as separate Steps).
 */
export interface BrewConfig {
  durationSec?: number;
  targetYieldGrams?: number;
  stopAtWeight?: boolean;
}
export interface SteamConfig {
  durationSec?: number;
  smartSteam?: boolean;
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

/** Discriminated union of Steps. `type` is the discriminant. */
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
