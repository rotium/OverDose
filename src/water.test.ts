import { describe, expect, it } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import {
  createWaterSeverity,
  WATER_HYSTERESIS_MM,
  waterSeverity,
  type WaterSeverity,
} from './water';
import type { WaterLevelsSnapshot } from './snapshot';

const lvl = (currentLevel: number, refillLevel = 3): WaterLevelsSnapshot => ({
  currentLevel,
  refillLevel,
});

// Drive a sequence of levels through the hysteretic accessor and collect the
// committed severity after each frame. warn pref = 5, refill (critical) = 3.
const run = (levels: Array<WaterLevelsSnapshot | null>): WaterSeverity[] =>
  createRoot((dispose) => {
    const [frame, setFrame] = createSignal<WaterLevelsSnapshot | null>(levels[0]);
    const sev = createWaterSeverity(frame, () => 5);
    const out: WaterSeverity[] = [sev()];
    for (const l of levels.slice(1)) {
      setFrame(l);
      out.push(sev());
    }
    dispose();
    return out;
  });

describe('waterSeverity (pure)', () => {
  it('is a hard threshold compare', () => {
    expect(waterSeverity(10, 5, 3)).toBe('normal');
    expect(waterSeverity(5, 5, 3)).toBe('warn');
    expect(waterSeverity(3, 5, 3)).toBe('critical');
  });
});

describe('createWaterSeverity (hysteretic)', () => {
  it('starts normal before any frame', () => {
    expect(run([null])).toEqual(['normal']);
  });

  it('escalates immediately at the threshold — alerts never fire late', () => {
    // 6 (normal) → 5 (warn) → 3 (critical), each committed on the same frame.
    expect(run([lvl(6), lvl(5), lvl(3)])).toEqual(['normal', 'warn', 'critical']);
  });

  it('absorbs jitter across the warn boundary (the retrigger bug)', () => {
    // Level oscillates around warn (5mm) by sub-mm. Without hysteresis this
    // flip-flops normal↔warn and re-fires the alert; here it sticks at warn
    // until the level clears warn + margin.
    const margin = WATER_HYSTERESIS_MM;
    const seq = run([lvl(6), lvl(4.9), lvl(5.1), lvl(4.8), lvl(5.2)]);
    expect(seq).toEqual(['normal', 'warn', 'warn', 'warn', 'warn']);
    // Only clears once it rises a full margin above warn.
    expect(run([lvl(4.9), lvl(5 + margin)])).toEqual(['warn', 'warn']);
    expect(run([lvl(4.9), lvl(5 + margin + 0.1)])).toEqual(['warn', 'normal']);
  });

  it('holds critical until the level clears refill + margin, then steps down', () => {
    const margin = WATER_HYSTERESIS_MM;
    // refill = 3. Bouncing just above 3 stays critical (jitter near refill).
    expect(run([lvl(2, 3), lvl(3.5, 3), lvl(2.5, 3)])).toEqual([
      'critical',
      'critical',
      'critical',
    ]);
    // Clearing refill + margin steps critical → warn (still ≤ warn=5).
    expect(run([lvl(2, 3), lvl(3 + margin + 0.1, 3)])).toEqual(['critical', 'warn']);
  });

  it('cascades critical → normal in one frame on a full refill', () => {
    // Jump well past warn + margin: should de-escalate all the way to normal.
    expect(run([lvl(2, 3), lvl(40, 3)])).toEqual(['critical', 'normal']);
  });
});
