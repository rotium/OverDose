import { describe, expect, it } from 'vitest';
import {
  isHeaterOff,
  isWarmingUp,
  type MachineSnapshot,
  type MachineState,
  type MachineSubstate,
} from './snapshot';

const snapshot = (
  state: MachineState,
  substate: MachineSubstate = 'idle',
): MachineSnapshot => ({
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
});

describe('isWarmingUp', () => {
  it('is false for a null snapshot (no machine data yet)', () => {
    expect(isWarmingUp(null)).toBe(false);
  });

  it('is true while state is booting', () => {
    expect(isWarmingUp(snapshot('booting'))).toBe(true);
  });

  it('is true when state=idle but substate=preparingForShot (boiler heating)', () => {
    // Real-hardware regression: the DE1 firmware emits heatWaterTank /
    // heatWaterHeater / stabilizeMixTemp substates during boiler warm-up
    // and reaprime collapses them all into preparingForShot. See
    // [[starter-skin-de1-substate-leak]].
    expect(isWarmingUp(snapshot('idle', 'preparingForShot'))).toBe(true);
  });

  it('is false when both state and substate are idle (machine ready)', () => {
    expect(isWarmingUp(snapshot('idle', 'idle'))).toBe(false);
  });

  it('is false during a real espresso prep (state=espresso)', () => {
    // state=espresso + substate=preparingForShot is what an actual shot looks
    // like — not a warm-up; the brew screen handles the shot lifecycle itself.
    expect(isWarmingUp(snapshot('espresso', 'preparingForShot'))).toBe(false);
  });

  it('is false when the machine is sleeping (SleepOverlay owns that state)', () => {
    expect(isWarmingUp(snapshot('sleeping'))).toBe(false);
  });

  it('is false in active operations (steam, hotWater, flush)', () => {
    expect(isWarmingUp(snapshot('steam'))).toBe(false);
    expect(isWarmingUp(snapshot('hotWater'))).toBe(false);
    expect(isWarmingUp(snapshot('flush'))).toBe(false);
  });
});

describe('isHeaterOff', () => {
  it('is false for a null snapshot', () => {
    expect(isHeaterOff(null)).toBe(false);
  });

  it('is true when state=idle and substate=errorNoAC (front switch off)', () => {
    expect(isHeaterOff(snapshot('idle', 'errorNoAC'))).toBe(true);
  });

  it('is false when state and substate are both idle (machine is normally ready)', () => {
    expect(isHeaterOff(snapshot('idle', 'idle'))).toBe(false);
  });

  it('is false while warming up (state=idle, substate=preparingForShot)', () => {
    expect(isHeaterOff(snapshot('idle', 'preparingForShot'))).toBe(false);
  });

  it('is false while the machine is sleeping', () => {
    expect(isHeaterOff(snapshot('sleeping'))).toBe(false);
  });
});
