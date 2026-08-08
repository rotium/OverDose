/**
 * Hot-water logic — pure helpers, no I/O, so the stop rule and the derived
 * numbers stay exhaustively testable. Ported in shape from reaprime's
 * `hot_water_stop.dart` (`nextHotWaterStop`), which is factored the same way
 * for the same reason.
 *
 * Why OverDose owns this at all: the gateway's `HotWaterSequencer` latches its
 * target the moment the machine enters `hotWater` and never re-reads it, so a
 * mid-pour ± would move the number on screen and change nothing about when the
 * water actually stops. Owning the stop is what makes ± real — and it lifts the
 * target off the DE1's single-byte volume field, so vessels above 255 mL work.
 *
 * We stay out of the gateway's way without touching its machine-wide
 * `stopHotWaterAtWeight` setting (flipping that would disarm stop-at-weight for
 * pours started at the group head while OverDose isn't even on screen — the
 * same multi-client fight as [[overdose-steam-pref-sync]]). Instead we write
 * `volume = 0` to the machine: the DE1's "no volume stop" convention, which
 * also makes the sequencer decline to arm (`if (target <= 0) return`).
 */

/** Seconds of flow projected ahead when deciding to stop — compensates for the
 *  latency between asking the machine to stop and the pump actually closing.
 *  Matches the gateway's `hotWaterFlowMultiplier` default. */
export const WATER_LOOKAHEAD_SEC = 0.3;

/** Post-tare window before the reading is trusted. Matches reaprime's
 *  `ScaleController.defaultSmoothingWindow`. */
export const WATER_TARE_SETTLE_MS = 600;

/**
 * The tare is trusted only once the scale has been *observed* at or below this
 * many grams — proof it actually applied. A meaningful pre-tare load (the cup
 * already on the platter) would otherwise trigger a false instant stop if the
 * physical tare lags the time window. If the tare never lands the stop simply
 * never arms and the firmware duration cap takes over, so this fails safe.
 */
export const WATER_TARE_CONFIRM_G = 3.0;

/** Give up on an arm that never turns into a pour. */
export const WATER_ARM_TIMEOUT_MS = 10_000;

/** A scale frame older than this is stale — treat the scale as absent. */
export const WATER_SCALE_FRESH_MS = 2_000;

/** Step for the mid-pour ± adjuster (mL). Matches Decenza's volume step; big
 *  enough to read on a cup, the way steam's ±5 s is big enough to feel. */
export const WATER_ADJUST_DELTA_ML = 10;

/** Headroom on the derived firmware duration cap. The cap only ever fires if
 *  OverDose has stopped watching, so it wants slack, not precision. */
const CAP_HEADROOM = 1.5;

/** DE1 `targetHotWaterDuration` is a single byte. */
const CAP_MIN_SEC = 5;
const CAP_MAX_SEC = 255;

/**
 * How long the pour is expected to take. Shown to the user as a quiet
 * `Takes ~25 s` line — purely informational, never a target. Undefined when
 * either input is missing or non-positive.
 */
export const waterEtaSec = (
  volumeMl: number | undefined,
  flow: number | undefined,
): number | undefined => {
  if (!volumeMl || !flow || volumeMl <= 0 || flow <= 0) return undefined;
  return volumeMl / flow;
};

/**
 * The firmware duration backstop, derived from volume and flow. Never shown,
 * never editable — it exists only so a crashed tablet can't flood the counter.
 * Falls back to the max when the inputs can't produce an estimate: a missing
 * estimate must not tighten the cap onto a legitimate pour.
 */
export const waterDurationCapSec = (
  volumeMl: number | undefined,
  flow: number | undefined,
): number => {
  const eta = waterEtaSec(volumeMl, flow);
  if (eta === undefined) return CAP_MAX_SEC;
  return Math.min(
    CAP_MAX_SEC,
    Math.max(CAP_MIN_SEC, Math.ceil(eta * CAP_HEADROOM)),
  );
};

/** Clamp a requested pour to what the vessel can take. An absent capacity
 *  imposes no ceiling (an ad-hoc pour with no vessel picked). */
export const clampVolumeToVessel = (
  volumeMl: number,
  capacityMl: number | undefined,
): number => {
  const floored = Math.max(0, volumeMl);
  if (!capacityMl || capacityMl <= 0) return floored;
  return Math.min(floored, capacityMl);
};

/** Which reading is driving the stop. Drives the prep switch label and the
 *  live hero's unit, so the screen always names what's actually running. */
export type WaterStopSensor = 'scale' | 'flow';

export interface WaterStopState {
  /** Live target — grams on the scale, millilitres when counting. The ± adjuster
   *  rewrites this mid-pour, which is the whole point of owning the stop. */
  targetAmount: number;
  /** Configured hot-water flow, used for the lookahead until the measured rate
   *  becomes trustworthy. */
  configuredFlow: number;
  /** Whether the machine has been seen in `hotWater` since arming. */
  activeSeen: boolean;
  /** Latched once we've asked to stop, so we ask exactly once. */
  stopRequested: boolean;
}

export interface WaterStopInput {
  /** True while the machine is in `hotWater`. */
  inHotWater: boolean;
  /** Time since arming (ms) — guards an arm that never becomes a pour. */
  sinceArmedMs: number;
  /**
   * Whether the measurement can be trusted yet. On the scale path that means
   * the tare both settled and was confirmed at ≤ {@link WATER_TARE_CONFIRM_G};
   * on the counting path it's true as soon as integration starts (there is no
   * tare to land).
   */
  measurementReady: boolean;
  /** Amount so far — grams poured, or millilitres counted. */
  measured: number | undefined;
  /** Rate of accumulation — g/s from the scale, mL/s from the group head. */
  rate: number | undefined;
}

export type WaterStopAction = 'wait' | 'clear' | 'stop';

export interface WaterStopDecision {
  action: WaterStopAction;
  /** Next state. Null only when the action is `clear`. */
  state: WaterStopState | null;
  /** Measured and projected amounts at the moment of a stop (0 otherwise). */
  measured: number;
  projected: number;
}

/**
 * The stop rule. Once the machine is actually seen pouring and the measurement
 * has settled, project a short time ahead (`measured + rate * lookahead`) and
 * ask to stop the moment that projection reaches the target.
 *
 * Deliberately identical for both sensors: grams-and-g/s and millilitres-and-
 * mL/s are the same arithmetic, and water is 1 g per mL. The caller picks which
 * pair to feed in.
 */
export const nextWaterStop = (
  state: WaterStopState,
  input: WaterStopInput,
): WaterStopDecision => {
  const wait = (s: WaterStopState): WaterStopDecision => ({
    action: 'wait',
    state: s,
    measured: 0,
    projected: 0,
  });

  let next = state;
  if (input.inHotWater) {
    next = next.activeSeen ? next : { ...next, activeSeen: true };
  } else if (next.activeSeen || input.sinceArmedMs > WATER_ARM_TIMEOUT_MS) {
    // Either we left hot water after pouring, or we armed and the pour never
    // started — disarm either way.
    return { action: 'clear', state: null, measured: 0, projected: 0 };
  }

  if (!next.activeSeen || next.stopRequested) return wait(next);
  if (!input.measurementReady) return wait(next);
  if (!(state.targetAmount > 0)) return wait(next);

  const measured = Number.isFinite(input.measured) ? (input.measured as number) : 0;
  const measuredRate =
    input.rate !== undefined && Number.isFinite(input.rate) && input.rate > 0
      ? input.rate
      : state.configuredFlow;
  const projected = measured + measuredRate * WATER_LOOKAHEAD_SEC;
  if (projected < state.targetAmount) return wait(next);

  return {
    action: 'stop',
    state: { ...next, stopRequested: true },
    measured,
    projected,
  };
};

/**
 * Apply a mid-pour ± to a live target. Never goes below zero; dropping the
 * target under what's already poured is legitimate and stops immediately,
 * which is the correct reading of "that's enough".
 */
export const adjustWaterTarget = (current: number, deltaMl: number): number =>
  Math.max(0, current + deltaMl);
