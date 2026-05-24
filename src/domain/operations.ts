/**
 * Step types: the machine actions that make up a Beverage's step sequence.
 * Closed set, predefined in code — the user composes Beverages by picking
 * from these but cannot add new types.
 *
 * Bean / Profile / Grinder + setting / Dose weight are NOT step types —
 * they're per-Recipe metadata (see `recipe.ts`). The pre-brew prep work
 * (weighing dose, grinding) is derived from those Recipe fields at run
 * time, not declared as Beverage steps.
 *
 * `auto-purge` is NOT a step type — it's a SteamConfig field (see
 * `steps.ts`).
 */
export const STEP_TYPES = ['brew', 'steam', 'water', 'flush'] as const;
export type StepType = (typeof STEP_TYPES)[number];

/**
 * Display label for a step type. Capitalises the first letter and turns
 * any hyphens into spaces. Used in the Beverage editor row, the step
 * picker, and the list-row sequence hints.
 */
export const formatStepType = (t: StepType): string => {
  const spaced = t.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};
