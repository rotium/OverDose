import { describe, expect, it } from 'vitest';
import { computeStopProgress } from './LiveEspressoView';
import type { ProfileSnapshot } from '../../api';

const profile = (totalSec: number, targetVolume?: number): ProfileSnapshot => ({
  title: 'p',
  // Two steps splitting the time so the helper actually iterates.
  steps: [
    { name: 'a', seconds: Math.floor(totalSec / 2) },
    { name: 'b', seconds: Math.ceil(totalSec / 2) },
  ],
  ...(targetVolume !== undefined ? { target_volume: targetVolume } : {}),
});

describe('computeStopProgress', () => {
  it("returns 'none' when no weight/volume target and no profile time exist", () => {
    const r = computeStopProgress(10, 0, 0, 5, null, true);
    expect(r.trigger).toBe('none');
    expect(r.value).toBe(0);
  });

  // --- Weight (scale connected) ---

  it('tracks weight toward the target when a scale is connected', () => {
    // 25g of 36 ≈ 69%. Profile time present but ignored — scale → weight.
    const r = computeStopProgress(25, 36, 0, 5, profile(30), true);
    expect(r.trigger).toBe('weight');
    expect(r.value).toBeCloseTo(25 / 36, 3);
  });

  it('commits to weight even before the value climbs (0 early in the shot)', () => {
    const r = computeStopProgress(NaN, 36, 0, 1, profile(30), true);
    expect(r.trigger).toBe('weight');
    expect(r.value).toBe(0);
  });

  it('caps the weight value at 1 even when past target', () => {
    const r = computeStopProgress(40, 36, 0, 5, profile(30), true);
    expect(r.trigger).toBe('weight');
    expect(r.value).toBe(1);
  });

  it('ignores a weight target with no scale — falls to time', () => {
    // A weight target with no scale can never fire; time is the floor.
    const r = computeStopProgress(25, 36, 0, 15, profile(30), false);
    expect(r.trigger).toBe('time');
    expect(r.value).toBeCloseTo(15 / 30, 3);
  });

  // --- Volume (no scale) ---

  it('tracks counted volume toward target_volume when no scale is connected', () => {
    // 20 mL of 50 = 40%.
    const r = computeStopProgress(NaN, 0, 20, 5, profile(30, 50), false);
    expect(r.trigger).toBe('volume');
    expect(r.value).toBeCloseTo(20 / 50, 3);
  });

  it('commits to volume even before any volume is counted', () => {
    const r = computeStopProgress(NaN, 0, 0, 1, profile(30, 50), false);
    expect(r.trigger).toBe('volume');
    expect(r.value).toBe(0);
  });

  it('caps the volume value at 1 even when past target', () => {
    const r = computeStopProgress(NaN, 0, 60, 5, profile(30, 50), false);
    expect(r.trigger).toBe('volume');
    expect(r.value).toBe(1);
  });

  it('ignores a volume target when a scale IS connected (gateway ignores volume)', () => {
    // Scale present, no weight target → nothing weight/volume fires → time.
    const r = computeStopProgress(NaN, 0, 20, 15, profile(30, 50), true);
    expect(r.trigger).toBe('time');
    expect(r.value).toBeCloseTo(15 / 30, 3);
  });

  it('prefers weight over volume when a scale is connected and both targets are set', () => {
    // auto mode w/ scale: both targets present, gateway stops on weight.
    const r = computeStopProgress(18, 36, 40, 5, profile(30, 50), true);
    expect(r.trigger).toBe('weight');
    expect(r.value).toBeCloseTo(18 / 36, 3);
  });

  // --- Time floor ---

  it('falls back to time when no weight/volume stop is applicable', () => {
    const r = computeStopProgress(NaN, 0, 0, 15, profile(30), true);
    expect(r.trigger).toBe('time');
    expect(r.value).toBeCloseTo(15 / 30, 3);
  });

  it('caps the time value at 1 past the profile duration', () => {
    const r = computeStopProgress(NaN, 0, 0, 45, profile(30), true);
    expect(r.trigger).toBe('time');
    expect(r.value).toBe(1);
  });

  it('handles a profile with steps missing `seconds` (older payloads) gracefully', () => {
    const p: ProfileSnapshot = {
      title: 'p',
      steps: [{ name: 'a' }, { name: 'b' }], // no seconds
    };
    // Weight target with a scale still leads; profile time resolves to 0.
    const r = computeStopProgress(5, 36, 0, 10, p, true);
    expect(r.trigger).toBe('weight');
    expect(r.value).toBeCloseTo(5 / 36, 3);
  });
});
