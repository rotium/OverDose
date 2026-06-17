import { describe, expect, it } from 'vitest';
import { resolveSeriesVisibility } from './LiveShotChart';
import type { TraceVisibility } from '../prefs';

const allOn: TraceVisibility = {
  pressure: true,
  flow: true,
  weightFlow: true,
  weight: true,
  mixTemp: true,
  targets: true,
  steps: true,
};

describe('resolveSeriesVisibility', () => {
  it('shows everything when every flag is on', () => {
    const r = resolveSeriesVisibility(allOn);
    for (const key of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
      expect(r[key]).toBe(true);
    }
  });

  it('hides only the chosen primary (and its target via the AND rule)', () => {
    const r = resolveSeriesVisibility({ ...allOn, pressure: false });
    expect(r[1]).toBe(false); // pressure primary hidden
    expect(r[6]).toBe(false); // target pressure follows primary
    expect(r[2]).toBe(true);
    expect(r[7]).toBe(true); // target flow unaffected
    expect(r[8]).toBe(true); // target mix unaffected
  });

  it('master targets flag hides all three dashed series at once', () => {
    const r = resolveSeriesVisibility({ ...allOn, targets: false });
    expect(r[6]).toBe(false);
    expect(r[7]).toBe(false);
    expect(r[8]).toBe(false);
    // Primaries unchanged.
    expect(r[1]).toBe(true);
    expect(r[2]).toBe(true);
    expect(r[3]).toBe(true);
    expect(r[4]).toBe(true);
    expect(r[5]).toBe(true);
  });

  // The bug report scenario: with the targets master off, toggling a
  // primary off then back on must NOT bring its target back.
  it('re-enabling a primary while targets master is off keeps its target hidden', () => {
    // Step 1 — user turns off the master targets flag.
    const targetsOff: TraceVisibility = { ...allOn, targets: false };
    const r1 = resolveSeriesVisibility(targetsOff);
    expect(r1[6]).toBe(false);

    // Step 2 — user hides pressure.
    const pressureOff: TraceVisibility = { ...targetsOff, pressure: false };
    const r2 = resolveSeriesVisibility(pressureOff);
    expect(r2[1]).toBe(false);
    expect(r2[6]).toBe(false);

    // Step 3 — user re-enables pressure. Target pressure MUST stay hidden.
    const pressureBackOn: TraceVisibility = { ...pressureOff, pressure: true };
    const r3 = resolveSeriesVisibility(pressureBackOn);
    expect(r3[1]).toBe(true); // pressure shown
    expect(r3[6]).toBe(false); // target stays hidden — this is the regression
  });

  // The opposite of the above — when the targets master IS on, toggling
  // a primary off then back on should bring the target back along with it.
  it('re-enabling a primary while targets master is on brings its target back too', () => {
    const pressureOff: TraceVisibility = { ...allOn, pressure: false };
    expect(resolveSeriesVisibility(pressureOff)[6]).toBe(false);

    const pressureBackOn: TraceVisibility = { ...pressureOff, pressure: true };
    const r = resolveSeriesVisibility(pressureBackOn);
    expect(r[1]).toBe(true);
    expect(r[6]).toBe(true);
  });

  it('toggling one primary does not affect other primaries or their targets', () => {
    const r = resolveSeriesVisibility({ ...allOn, weightFlow: false });
    expect(r[5]).toBe(false); // weight flow hidden
    // All others untouched.
    expect(r[1]).toBe(true);
    expect(r[2]).toBe(true);
    expect(r[3]).toBe(true);
    expect(r[4]).toBe(true);
    expect(r[6]).toBe(true);
    expect(r[7]).toBe(true);
    expect(r[8]).toBe(true);
  });
});
