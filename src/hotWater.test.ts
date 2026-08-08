import { describe, expect, it } from 'vitest';
import {
  adjustWaterTarget,
  clampVolumeToVessel,
  nextWaterStop,
  waterDurationCapSec,
  waterEtaSec,
  WATER_ARM_TIMEOUT_MS,
  WATER_LOOKAHEAD_SEC,
  type WaterStopState,
} from './hotWater';

const armed = (over: Partial<WaterStopState> = {}): WaterStopState => ({
  targetAmount: 150,
  configuredFlow: 6,
  activeSeen: true,
  stopRequested: false,
  ...over,
});

const input = (over: Partial<Parameters<typeof nextWaterStop>[1]> = {}) => ({
  inHotWater: true,
  sinceArmedMs: 1000,
  measurementReady: true,
  measured: 0,
  rate: 6,
  ...over,
});

describe('waterEtaSec', () => {
  it('is volume over flow', () => {
    expect(waterEtaSec(150, 6)).toBe(25);
    expect(waterEtaSec(300, 6)).toBe(50);
  });

  it('is undefined when either input is missing or non-positive', () => {
    expect(waterEtaSec(undefined, 6)).toBeUndefined();
    expect(waterEtaSec(150, undefined)).toBeUndefined();
    expect(waterEtaSec(0, 6)).toBeUndefined();
    expect(waterEtaSec(150, 0)).toBeUndefined();
  });
});

describe('waterDurationCapSec', () => {
  it('gives the estimate 50% headroom', () => {
    expect(waterDurationCapSec(150, 6)).toBe(38); // 25s -> 37.5 -> ceil
    expect(waterDurationCapSec(300, 6)).toBe(75);
    expect(waterDurationCapSec(80, 8)).toBe(15);
  });

  it('clamps at the single-byte firmware ceiling', () => {
    // 750mL @ 4mL/s = 187.5s -> 282s, over the byte.
    expect(waterDurationCapSec(750, 4)).toBe(255);
  });

  it('never drops below a floor a real pour could hit', () => {
    expect(waterDurationCapSec(10, 10)).toBe(5);
  });

  it('falls back to the max when no estimate is possible', () => {
    // A missing estimate must not tighten the cap onto a legitimate pour.
    expect(waterDurationCapSec(undefined, 6)).toBe(255);
    expect(waterDurationCapSec(150, undefined)).toBe(255);
  });
});

describe('clampVolumeToVessel', () => {
  it('caps at the vessel capacity', () => {
    expect(clampVolumeToVessel(400, 300)).toBe(300);
    expect(clampVolumeToVessel(150, 300)).toBe(150);
  });

  it('imposes no ceiling without a capacity', () => {
    expect(clampVolumeToVessel(900, undefined)).toBe(900);
    expect(clampVolumeToVessel(900, 0)).toBe(900);
  });

  it('never goes negative', () => {
    expect(clampVolumeToVessel(-20, 300)).toBe(0);
  });
});

describe('adjustWaterTarget', () => {
  it('adds and subtracts', () => {
    expect(adjustWaterTarget(150, 10)).toBe(160);
    expect(adjustWaterTarget(150, -10)).toBe(140);
  });

  it('floors at zero rather than going negative', () => {
    expect(adjustWaterTarget(5, -10)).toBe(0);
  });
});

describe('nextWaterStop', () => {
  it('waits while the projection is short of the target', () => {
    const d = nextWaterStop(armed(), input({ measured: 100, rate: 6 }));
    expect(d.action).toBe('wait');
  });

  it('stops once the projection reaches the target', () => {
    // 148 + 6*0.3 = 149.8 -> short. 149 + 6*0.3 = 150.8 -> stop.
    expect(nextWaterStop(armed(), input({ measured: 148 })).action).toBe('wait');
    const d = nextWaterStop(armed(), input({ measured: 149 }));
    expect(d.action).toBe('stop');
    expect(d.projected).toBeCloseTo(149 + 6 * WATER_LOOKAHEAD_SEC);
    expect(d.state?.stopRequested).toBe(true);
  });

  it('latches so it only ever asks once', () => {
    const d = nextWaterStop(
      armed({ stopRequested: true }),
      input({ measured: 400 }),
    );
    expect(d.action).toBe('wait');
  });

  it('holds off until the measurement is ready', () => {
    // An unconfirmed tare with the cup still on the platter would otherwise
    // read as a finished pour and fire instantly.
    const d = nextWaterStop(
      armed(),
      input({ measured: 220, measurementReady: false }),
    );
    expect(d.action).toBe('wait');
  });

  it('falls back to the configured flow when no rate is measured yet', () => {
    const d = nextWaterStop(
      armed({ configuredFlow: 6 }),
      input({ measured: 149, rate: undefined }),
    );
    expect(d.action).toBe('stop');
  });

  it('ignores a zero or negative measured rate', () => {
    const d = nextWaterStop(armed(), input({ measured: 149, rate: 0 }));
    expect(d.action).toBe('stop'); // configuredFlow used instead
  });

  it('marks activeSeen on the first hotWater frame', () => {
    const d = nextWaterStop(
      armed({ activeSeen: false }),
      input({ measured: 0 }),
    );
    expect(d.action).toBe('wait');
    expect(d.state?.activeSeen).toBe(true);
  });

  it('waits rather than stopping before the pour is seen', () => {
    const d = nextWaterStop(
      armed({ activeSeen: false }),
      input({ inHotWater: false, measured: 999, sinceArmedMs: 100 }),
    );
    expect(d.action).toBe('wait');
  });

  it('clears when the pour ends', () => {
    const d = nextWaterStop(armed(), input({ inHotWater: false }));
    expect(d.action).toBe('clear');
    expect(d.state).toBeNull();
  });

  it('clears when an arm never becomes a pour', () => {
    const d = nextWaterStop(
      armed({ activeSeen: false }),
      input({ inHotWater: false, sinceArmedMs: WATER_ARM_TIMEOUT_MS + 1 }),
    );
    expect(d.action).toBe('clear');
  });

  it('never stops on a zero target', () => {
    // Manual mode / no target set — the firmware cap is the only backstop.
    const d = nextWaterStop(armed({ targetAmount: 0 }), input({ measured: 500 }));
    expect(d.action).toBe('wait');
  });

  it('stops immediately when ± drops the target below what is poured', () => {
    const d = nextWaterStop(armed({ targetAmount: 90 }), input({ measured: 100 }));
    expect(d.action).toBe('stop');
  });

  it('drives the counting path with the same arithmetic', () => {
    // mL and mL/s in place of g and g/s — water is 1 g per mL.
    const d = nextWaterStop(
      armed({ targetAmount: 300, configuredFlow: 4 }),
      input({ measured: 299, rate: 4 }),
    );
    expect(d.action).toBe('stop');
  });
});
