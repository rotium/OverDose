import type { MachineSnapshot, MachineSubstate } from './snapshot';

/**
 * The single place that turns a raw machine `(state, substate)` into "what is
 * the machine doing right now?" — a meaningful, UI-facing classification.
 *
 * Components should reason about `MachineActivity` (via `deriveActivity`)
 * instead of re-deriving from `state`/`substate` themselves. That keeps the
 * one lossy/quirky mapping (warm-up substates, steam phases, error faults) in
 * one audited place. See `docs/states.md` for the underlying state model.
 *
 * `deriveActivity` is a pure function of a single snapshot. It deliberately
 * cannot resolve cases that need history — notably "steam paused/finished"
 * vs "steam warming up", since the gateway flattens both `pausedSteam` and
 * `puffing` to substate `idle`. Those are left as `steam/steaming` here; a
 * stateful tracker (future) is needed to tell them apart.
 */
export type EspressoPhase = 'heating' | 'preinfusion' | 'pouring' | 'done';
export type SteamPhase = 'heating' | 'steaming' | 'purging';
export type WaterPhase = 'heating' | 'pouring';
export type CleanPhase = 'start' | 'group' | 'soak' | 'steam';

export type MachineActivity =
  | { kind: 'offline' } // no snapshot yet
  | { kind: 'sleeping' }
  | { kind: 'booting' }
  | { kind: 'idle' } // ready
  | { kind: 'warmingUp' } // boiler climbing to target
  | { kind: 'heaterOff' } // front power switch off (errorNoAC)
  | { kind: 'needsWater' }
  | { kind: 'busy' }
  | { kind: 'schedIdle' }
  | { kind: 'skipStep' }
  | { kind: 'calibration' }
  | { kind: 'selfTest' }
  | { kind: 'fwUpgrade' }
  | { kind: 'espresso'; phase: EspressoPhase }
  | { kind: 'steam'; phase: SteamPhase }
  | { kind: 'hotWater'; phase: WaterPhase }
  | { kind: 'flush' }
  | { kind: 'steamRinse' }
  | { kind: 'cleaning'; phase: CleanPhase }
  | { kind: 'descaling'; phase: CleanPhase }
  | { kind: 'error'; fault: MachineSubstate };

const isErrorSubstate = (s: MachineSubstate): boolean => s.startsWith('error');

const espressoPhase = (s: MachineSubstate): EspressoPhase => {
  switch (s) {
    case 'preparingForShot':
      return 'heating';
    case 'preinfusion':
      return 'preinfusion';
    case 'pouringDone':
      return 'done';
    default:
      return 'pouring'; // `pouring`, and anything else mid-shot
  }
};

const cleanPhase = (s: MachineSubstate): CleanPhase => {
  switch (s) {
    case 'cleaningStart':
      return 'start';
    case 'cleanSoaking':
      return 'soak';
    case 'cleaningSteam':
      return 'steam';
    default:
      return 'group'; // `cleaningGroup`, and anything else
  }
};

/**
 * Classify a single snapshot. Total over all states/substates; an unrecognised
 * state falls back to `idle` so a future firmware value degrades rather than
 * throwing.
 */
export const deriveActivity = (
  snap: MachineSnapshot | null,
): MachineActivity => {
  if (!snap) return { kind: 'offline' };
  const { state, substate } = snap.state;
  switch (state) {
    case 'sleeping':
      return { kind: 'sleeping' };
    case 'booting':
      return { kind: 'booting' };
    case 'needsWater':
      return { kind: 'needsWater' };
    case 'busy':
      return { kind: 'busy' };
    case 'schedIdle':
      return { kind: 'schedIdle' };
    case 'skipStep':
      return { kind: 'skipStep' };
    case 'calibration':
      return { kind: 'calibration' };
    case 'selfTest':
      return { kind: 'selfTest' };
    case 'fwUpgrade':
      return { kind: 'fwUpgrade' };
    case 'error':
      return { kind: 'error', fault: substate };
    case 'espresso':
      return { kind: 'espresso', phase: espressoPhase(substate) };
    case 'hotWater':
      return {
        kind: 'hotWater',
        phase: substate === 'preparingForShot' ? 'heating' : 'pouring',
      };
    case 'flush':
      return { kind: 'flush' };
    case 'steamRinse':
      return { kind: 'steamRinse' };
    case 'steam':
      // Real hardware: active steaming reports substate `pouring`. Once steam
      // stops, the firmware parks under parent `steam` with substate
      // `pouringDone` (or `idle` — the gateway flattens the firmware
      // `puffing`/`pausedSteam` substates to `idle`) while it runs the wand
      // purge, then goes to top-level `idle`. `preparingForShot` is boiler
      // warm-up. NOTE: single-snapshot, so a cold subscribe landing on
      // `steam`+`idle` reads as `purging`; the live UI uses the stateful
      // `opPhase` in LiveShotContext, which tracks whether steaming was seen.
      if (substate === 'preparingForShot') return { kind: 'steam', phase: 'heating' };
      if (substate === 'pouring') return { kind: 'steam', phase: 'steaming' };
      return { kind: 'steam', phase: 'purging' };
    case 'airPurge':
      // Legacy/fallback. On current firmware the purge surfaces as
      // `steam/pouringDone`, not a top-level `airPurge` — but keep it mapped
      // so a firmware that does expose it still folds into the steam session.
      return { kind: 'steam', phase: 'purging' };
    case 'cleaning':
      return { kind: 'cleaning', phase: cleanPhase(substate) };
    case 'descaling':
      return { kind: 'descaling', phase: cleanPhase(substate) };
    case 'idle':
    case 'heating':
    case 'preheating':
      if (substate === 'errorNoAC') return { kind: 'heaterOff' };
      if (substate === 'preparingForShot') return { kind: 'warmingUp' };
      if (isErrorSubstate(substate)) return { kind: 'error', fault: substate };
      return { kind: 'idle' };
    default:
      return { kind: 'idle' };
  }
};

/** Live machine operations that map to a step / drawer view. */
export type LiveOp = 'espresso' | 'steam' | 'hotWater' | 'flush';

/**
 * The live operation an activity represents, or null when the machine isn't
 * running one. `airPurge` reports as `steam` (folded), matching the drawer.
 */
export const activityOp = (a: MachineActivity): LiveOp | null => {
  switch (a.kind) {
    case 'espresso':
      return 'espresso';
    case 'steam':
      return 'steam';
    case 'hotWater':
      return 'hotWater';
    case 'flush':
      return 'flush';
    default:
      return null;
  }
};
