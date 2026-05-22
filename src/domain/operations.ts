/**
 * Operations: atomic actions the machine system performs (machine-driven).
 * Closed set, predefined in code. User cannot extend.
 *
 * Scale-driven actions count as machine Operations because the scale
 * integrates with the machine system (auto-tare, stop-at-weight, etc.).
 */
export const OPERATION_TYPES = ['brew', 'steam', 'water', 'flush', 'weight'] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

/**
 * Prep activities: user-driven setup steps. Closed set, predefined.
 * Not Operations — these are things the user does, not the machine.
 */
export const PREP_TYPES = ['bean-selection', 'profile-selection', 'grind'] as const;
export type PrepType = (typeof PREP_TYPES)[number];

/** Step types: union of Operations + Prep activities. */
export type StepType = OperationType | PrepType;
export const ALL_STEP_TYPES = [...OPERATION_TYPES, ...PREP_TYPES] as const;

export const isOperationType = (t: StepType): t is OperationType =>
  (OPERATION_TYPES as readonly string[]).includes(t);
export const isPrepType = (t: StepType): t is PrepType =>
  (PREP_TYPES as readonly string[]).includes(t);
