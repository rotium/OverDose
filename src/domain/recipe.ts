import type { AnyStepConfig } from './steps';

/**
 * A Recipe: a configured way to make a specific Beverage. References its
 * Beverage by id (reference model — see [[starter-skin-vocabulary]]) and
 * carries per-step config overrides keyed by `BeverageStep.id`.
 *
 * Plus the per-Recipe prep metadata that's *not* part of the Beverage's
 * step sequence: which bean, which grinder + setting, what dose to weigh,
 * which espresso profile. These aren't Beverage steps because they don't
 * map to machine actions — the runtime walks them as prep prompts before
 * the Beverage's first step runs.
 *
 * `overrides` may be missing keys or partial values; all per-step config
 * fields are optional. The effective config for a step at run time is:
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
  /**
   * Bean used for this Recipe. References Bean.id from the Bean library
   * (not yet built — Library subsection is a TODO shell). Optional so
   * Recipes can exist before a Bean is picked.
   */
  beanId?: string;
  /**
   * Grinder used for this Recipe. References Grinder.id from the
   * Equipment library (TODO).
   */
  grinderId?: string;
  /** Grinder setting to dial in for this Recipe's bean. Number space depends on the grinder. */
  grinderSetting?: number;
  /** Dose-in weight (grams) — the user weighs this much before brewing. */
  doseGrams?: number;
  /**
   * Espresso profile used by the brew step. References Profile.id from
   * the Profile library (TODO). Per-Recipe rather than per-Beverage so
   * the user can tune profile per-bean (matches grind / dose / bean).
   */
  profileId?: string;
  /** Optional path to a tile image displayed in the picker. */
  iconUrl?: string;
}
