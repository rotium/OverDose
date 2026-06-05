import { describe, expect, it } from 'vitest';
import {
  autoStopLabel,
  autoStopUnavailableReason,
  computeStopTargets,
  isStopModeApplicable,
} from './autoStop';

describe('isStopModeApplicable', () => {
  it('auto and off always apply', () => {
    for (const scale of [true, false]) {
      expect(isStopModeApplicable('auto', scale)).toBe(true);
      expect(isStopModeApplicable('off', scale)).toBe(true);
    }
  });

  it('weight needs a scale; volume needs no scale', () => {
    expect(isStopModeApplicable('weight', true)).toBe(true);
    expect(isStopModeApplicable('weight', false)).toBe(false);
    expect(isStopModeApplicable('volume', false)).toBe(true);
    expect(isStopModeApplicable('volume', true)).toBe(false);
  });
});

describe('autoStopUnavailableReason', () => {
  it('explains why an inapplicable mode is unavailable, else null', () => {
    expect(autoStopUnavailableReason('weight', false)).toBe('needs a scale');
    expect(autoStopUnavailableReason('volume', true)).toBe('needs no scale');
    expect(autoStopUnavailableReason('weight', true)).toBeNull();
    expect(autoStopUnavailableReason('auto', false)).toBeNull();
  });
});

describe('autoStopLabel', () => {
  it('maps each mode to a user-facing label', () => {
    expect(autoStopLabel('auto')).toBe('Automatic');
    expect(autoStopLabel('weight')).toBe('By weight');
    expect(autoStopLabel('volume')).toBe('By volume');
    expect(autoStopLabel('off')).toBe('Manual');
  });
});

describe('computeStopTargets', () => {
  const opts = { draftYieldG: 36, draftVolumeMl: 45, profileVolumeMl: 50 };

  it('auto sends both (volume from draft, then profile, then 0)', () => {
    expect(computeStopTargets('auto', opts)).toEqual({
      targetYield: 36,
      targetVolume: 45,
    });
    expect(
      computeStopTargets('auto', { draftYieldG: 36, profileVolumeMl: 50 }),
    ).toEqual({ targetYield: 36, targetVolume: 50 });
    expect(computeStopTargets('auto', {})).toEqual({
      targetYield: null,
      targetVolume: 0,
    });
  });

  it('weight keeps yield, forces volume to 0', () => {
    expect(computeStopTargets('weight', opts)).toEqual({
      targetYield: 36,
      targetVolume: 0,
    });
  });

  it('volume clears yield, keeps volume', () => {
    expect(computeStopTargets('volume', opts)).toEqual({
      targetYield: null,
      targetVolume: 45,
    });
  });

  it('off clears yield and forces volume to 0', () => {
    expect(computeStopTargets('off', opts)).toEqual({
      targetYield: null,
      targetVolume: 0,
    });
  });
});
