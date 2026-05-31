import { describe, expect, it } from 'vitest';
import { deriveActivity, activityOp } from './machineActivity';
import type { MachineActivity } from './machineActivity';
import type {
  MachineSnapshot,
  MachineState,
  MachineSubstate,
} from './snapshot';

const snap = (
  state: MachineState,
  substate: MachineSubstate = 'idle',
): MachineSnapshot =>
  ({
    timestamp: '2026-05-29T00:00:00Z',
    state: { state, substate },
    flow: 0,
    pressure: 0,
    targetFlow: 0,
    targetPressure: 0,
    mixTemperature: 0,
    groupTemperature: 0,
    targetMixTemperature: 0,
    targetGroupTemperature: 0,
    profileFrame: 0,
    steamTemperature: 0,
  }) as MachineSnapshot;

describe('deriveActivity', () => {
  it('returns offline for a null snapshot', () => {
    expect(deriveActivity(null)).toEqual({ kind: 'offline' });
  });

  const cases: Array<[MachineState, MachineSubstate, MachineActivity]> = [
    ['sleeping', 'idle', { kind: 'sleeping' }],
    ['booting', 'idle', { kind: 'booting' }],
    ['needsWater', 'idle', { kind: 'needsWater' }],
    ['busy', 'idle', { kind: 'busy' }],
    ['schedIdle', 'idle', { kind: 'schedIdle' }],
    ['skipStep', 'idle', { kind: 'skipStep' }],
    ['calibration', 'idle', { kind: 'calibration' }],
    ['selfTest', 'idle', { kind: 'selfTest' }],
    ['fwUpgrade', 'idle', { kind: 'fwUpgrade' }],

    // idle + warm-up / heater-off / faults
    ['idle', 'idle', { kind: 'idle' }],
    ['idle', 'preparingForShot', { kind: 'warmingUp' }],
    ['idle', 'errorNoAC', { kind: 'heaterOff' }],
    ['idle', 'errorTSensor', { kind: 'error', fault: 'errorTSensor' }],

    // espresso phases
    ['espresso', 'preparingForShot', { kind: 'espresso', phase: 'heating' }],
    ['espresso', 'preinfusion', { kind: 'espresso', phase: 'preinfusion' }],
    ['espresso', 'pouring', { kind: 'espresso', phase: 'pouring' }],
    ['espresso', 'pouringDone', { kind: 'espresso', phase: 'done' }],

    // steam phases. Real hardware: `pouring` = steaming; once steam stops the
    // firmware parks under `steam` with `pouringDone`/`idle` while it purges.
    // Single-snapshot, so `steam`+`idle` reads as purging (the stateful opPhase
    // in LiveShotContext disambiguates warm-up from stopped using history).
    ['steam', 'preparingForShot', { kind: 'steam', phase: 'heating' }],
    ['steam', 'pouring', { kind: 'steam', phase: 'steaming' }],
    ['steam', 'pouringDone', { kind: 'steam', phase: 'purging' }],
    ['steam', 'idle', { kind: 'steam', phase: 'purging' }],
    ['airPurge', 'idle', { kind: 'steam', phase: 'purging' }],

    // hot water + flush
    ['hotWater', 'preparingForShot', { kind: 'hotWater', phase: 'heating' }],
    ['hotWater', 'pouring', { kind: 'hotWater', phase: 'pouring' }],
    ['flush', 'pouring', { kind: 'flush' }],
    ['steamRinse', 'idle', { kind: 'steamRinse' }],

    // clean + descale phases
    ['cleaning', 'cleaningStart', { kind: 'cleaning', phase: 'start' }],
    ['cleaning', 'cleaningGroup', { kind: 'cleaning', phase: 'group' }],
    ['cleaning', 'cleanSoaking', { kind: 'cleaning', phase: 'soak' }],
    ['descaling', 'cleaningSteam', { kind: 'descaling', phase: 'steam' }],

    // error state carries the fault substate
    ['error', 'errorPSensor', { kind: 'error', fault: 'errorPSensor' }],
  ];

  for (const [state, substate, expected] of cases) {
    it(`maps ${state}/${substate} → ${JSON.stringify(expected)}`, () => {
      expect(deriveActivity(snap(state, substate))).toEqual(expected);
    });
  }
});

describe('activityOp', () => {
  it('maps live operations to their op, others to null', () => {
    expect(activityOp(deriveActivity(snap('espresso', 'pouring')))).toBe('espresso');
    expect(activityOp(deriveActivity(snap('steam', 'pouring')))).toBe('steam');
    expect(activityOp(deriveActivity(snap('airPurge')))).toBe('steam'); // folded
    expect(activityOp(deriveActivity(snap('hotWater', 'pouring')))).toBe('hotWater');
    expect(activityOp(deriveActivity(snap('flush', 'pouring')))).toBe('flush');
    expect(activityOp(deriveActivity(snap('idle')))).toBeNull();
    expect(activityOp(deriveActivity(null))).toBeNull();
  });
});
