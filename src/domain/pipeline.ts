import type { Step, StepOfType } from './steps';
import type { StepType } from './operations';

/**
 * Pipeline: an ordered list of Steps that defines the shape of a flow.
 * User-configurable (full CRUD). Both Operations and Prep activities can be
 * present in any order — the user decides (e.g. weigh-beans before grind,
 * or grind first; flush-then-brew vs. brew-then-flush).
 */
export interface Pipeline {
  id: string;
  name: string;
  steps: Step[];
}

/** Helper: build a typed Step without writing the discriminant twice. */
export const step = <T extends StepType>(
  type: T,
  config: StepOfType<T>['config'],
): StepOfType<T> => ({ type, config }) as StepOfType<T>;
