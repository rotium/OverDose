import type { Step, StepOfType } from './steps';
import type { StepType } from './operations';

/**
 * A step in a Routine definition: a (type, config) pair plus a stable id.
 *
 * The id is load-bearing: Recipe overrides key by `stepId`, so reordering
 * or renaming the step type doesn't unlink overrides. Editors must assign
 * an id at creation time (via `routineStep()` or `crypto.randomUUID()`).
 */
export type RoutineStep = Step & { id: string };

/**
 * A Routine: "how I brew this drink" — an ordered sequence of machine
 * steps (brew / steam / water / flush) plus Routine-level default config
 * per step. Carries personal preferences for the routine as a whole
 * (purge timing, default yields). The per-bean/per-batch values live on
 * Recipes that reference this Routine.
 *
 * `hidden` marks a Routine as a private clone created by detaching a
 * single Recipe from its parent (see [[starter-skin-vocabulary]]). The
 * Routine Library filters these out; the runtime treats them like any
 * other Routine. Garbage-collected when the last referencing Recipe is
 * deleted.
 */
export interface Routine {
  id: string;
  name: string;
  hidden?: boolean;
  steps: RoutineStep[];
}

/** Helper: build a typed RoutineStep with an auto-generated id. */
export const routineStep = <T extends StepType>(
  type: T,
  config: StepOfType<T>['config'],
  id: string = crypto.randomUUID(),
): RoutineStep => ({ id, type, config }) as RoutineStep;
