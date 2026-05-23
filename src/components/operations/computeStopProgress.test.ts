import { describe, expect, it } from 'vitest';
import { computeStopProgress } from './LiveEspressoView';
import type { ProfileSnapshot } from '../../api';

const profile = (totalSec: number): ProfileSnapshot => ({
  title: 'p',
  // Two steps splitting the time so the helper actually iterates.
  steps: [
    { name: 'a', seconds: Math.floor(totalSec / 2) },
    { name: 'b', seconds: Math.ceil(totalSec / 2) },
  ],
});

describe('computeStopProgress', () => {
  it("returns 'none' when neither a weight target nor a profile time is known", () => {
    const r = computeStopProgress(10, 0, 5, null);
    expect(r.trigger).toBe('none');
    expect(r.value).toBe(0);
  });

  it('tracks weight progress when targetYield is set and leading', () => {
    // 25g of 36 ≈ 69%, with no profile so timeP is 0.
    const r = computeStopProgress(25, 36, 5, null);
    expect(r.trigger).toBe('weight');
    expect(r.value).toBeCloseTo(25 / 36, 3);
  });

  it('falls back to time when no weight target is configured', () => {
    const r = computeStopProgress(10, 0, 15, profile(30));
    expect(r.trigger).toBe('time');
    expect(r.value).toBeCloseTo(15 / 30, 3);
  });

  it('reports time when time progress overtakes weight progress', () => {
    // Weight: 5/36 ≈ 14%. Time: 20/30 ≈ 67%. Time leads.
    const r = computeStopProgress(5, 36, 20, profile(30));
    expect(r.trigger).toBe('time');
    expect(r.value).toBeCloseTo(20 / 30, 3);
  });

  it('reports weight when weight progress is ahead even with a profile time', () => {
    // Weight: 30/36 ≈ 83%. Time: 10/30 ≈ 33%. Weight leads.
    const r = computeStopProgress(30, 36, 10, profile(30));
    expect(r.trigger).toBe('weight');
    expect(r.value).toBeCloseTo(30 / 36, 3);
  });

  it('caps the value at 1 even when the leading trigger is past target', () => {
    const r = computeStopProgress(40, 36, 5, profile(30));
    expect(r.trigger).toBe('weight');
    expect(r.value).toBe(1);
  });

  it('treats NaN weight (no scale) as 0 weight progress', () => {
    const r = computeStopProgress(NaN, 36, 10, profile(30));
    // Time leads because weightP collapsed to 0.
    expect(r.trigger).toBe('time');
    expect(r.value).toBeCloseTo(10 / 30, 3);
  });

  it('handles a profile with steps missing `seconds` (older payloads) gracefully', () => {
    const p: ProfileSnapshot = {
      title: 'p',
      steps: [{ name: 'a' }, { name: 'b' }], // no seconds
    };
    const r = computeStopProgress(5, 36, 10, p);
    // Time total resolves to 0, so timeP = 0. Weight wins (5/36 ≈ 14%).
    expect(r.trigger).toBe('weight');
    expect(r.value).toBeCloseTo(5 / 36, 3);
  });
});
