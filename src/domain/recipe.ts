import type { AnyStepConfig } from './steps';

/**
 * A Recipe: a configured way to make a specific Routine. References its
 * Routine by id (reference model — see [[starter-skin-vocabulary]]) and
 * carries per-step config overrides keyed by `RoutineStep.id`.
 *
 * Plus the per-Recipe prep metadata that's *not* part of the Routine's
 * step sequence: which bean, which grinder + setting, what dose to weigh,
 * which espresso profile. These aren't Routine steps because they don't
 * map to machine actions — the runtime walks them as prep prompts before
 * the Routine's first step runs.
 *
 * `overrides` may be missing keys or partial values; all per-step config
 * fields are optional. The effective config for a step at run time is:
 *
 *   run-time override (ephemeral) → Recipe.overrides[stepId] →
 *   Routine.steps[i].config → operation-code fallback
 *
 * Missing keys at every layer means the field stays undefined and the
 * operation either uses its own default or treats the step as unconfigured.
 */
export interface Recipe {
  id: string;
  name: string;
  routineId: string;
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
   * Stop-at-weight target (grams of routine in the cup). When set and a
   * scale is connected, the machine auto-stops the shot at this weight.
   * Maps to the gateway's `workflow.context.targetYield` at brew time —
   * a clean context-layer override that doesn't alter the profile's
   * identity. Requires a scale; ignored (falls back to volume / profile
   * time) when none is connected.
   */
  targetYieldGrams?: number;
  /**
   * Stop-at-volume target (mL). The **no-scale fallback** stop: only
   * consulted when no scale is connected (weight wins otherwise). Maps to
   * the profile's `target_volume`, so applying it means pushing a
   * content-modified profile to the *current workflow only* — it never
   * enters the profile library and doesn't persist past a restart.
   */
  targetVolumeMl?: number;
  /**
   * Espresso profile used by the brew step. References Profile.id from
   * the Profile library. Per-Recipe rather than per-Routine so the user
   * can tune profile per-bean (matches grind / dose / bean).
   */
  profileId?: string;
  /**
   * Milk pitcher used by the steam step. References Pitcher.id from the
   * Steam library; the pitcher carries the steam parameters (duration,
   * temp, flow) applied at brew time. Optional — when unset (or the
   * referenced pitcher is gone) the steam step falls back to the machine's
   * current steam settings.
   */
  pitcherId?: string;
  /** Optional path to a tile image displayed in the picker. */
  iconUrl?: string;
  /**
   * Hidden from the Home recipe picker when true (e.g. its bean ran out and
   * it's temporarily out of rotation). Still fully editable + brewable — it
   * just drops off the main page. The Library shows hidden recipes (dimmed)
   * so they can be un-hidden. Filtered by `RecipeRepository.listVisible()`.
   */
  hidden?: boolean;
}
