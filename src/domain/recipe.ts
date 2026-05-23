import type { AnyStepConfig } from './steps';

/**
 * A Recipe: a configured way to make a specific Beverage. References its
 * Beverage by id (reference model — see [[starter-skin-vocabulary]]) and
 * carries per-step config overrides keyed by `BeverageStep.id`.
 *
 * `overrides` may be missing keys or partial values; everything is
 * optional. The effective config for a step at run time is:
 *
 *   run-time override (ephemeral) → Recipe.overrides[stepId] →
 *   Beverage.steps[i].config → operation-code fallback
 *
 * Missing keys at every layer means the field stays undefined and the
 * operation either uses its own default or treats the step as unconfigured.
 */
export interface Recipe {
  id: string;
  name: string;
  beverageId: string;
  overrides: Record<string, Partial<AnyStepConfig>>;
  /** Optional path to a tile image displayed in the picker. */
  iconUrl?: string;
}
