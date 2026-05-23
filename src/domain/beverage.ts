import type { Step, StepOfType } from './steps';
import type { StepType } from './operations';

/**
 * A step in a Beverage definition: a (type, config) pair plus a stable id.
 *
 * The id is load-bearing: Recipe overrides key by `stepId`, so reordering
 * or renaming the step type doesn't unlink overrides. Editors must assign
 * an id at creation time (via `beverageStep()` or `crypto.randomUUID()`).
 */
export type BeverageStep = Step & { id: string };

/**
 * A Beverage: "how I brew this drink" — a sequence of steps plus
 * Beverage-level default config per step. Carries my personal preferences
 * for the beverage as a whole (purge timing, flush durations, etc.); the
 * per-bean/per-batch values live on Recipes that reference this Beverage.
 *
 * `hidden` marks a Beverage as a private clone created by detaching a
 * single Recipe from its parent (see [[starter-skin-vocabulary]]). The
 * Beverage Library filters these out; the runtime treats them like any
 * other Beverage. Garbage-collected when the last referencing Recipe is
 * deleted.
 */
export interface Beverage {
  id: string;
  name: string;
  hidden?: boolean;
  steps: BeverageStep[];
}

/** Helper: build a typed BeverageStep with an auto-generated id. */
export const beverageStep = <T extends StepType>(
  type: T,
  config: StepOfType<T>['config'],
  id: string = crypto.randomUUID(),
): BeverageStep => ({ id, type, config }) as BeverageStep;
