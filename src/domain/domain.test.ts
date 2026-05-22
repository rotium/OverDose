import { describe, it, expect } from 'vitest';
import {
  OPERATION_TYPES,
  PREP_TYPES,
  isOperationType,
  isPrepType,
} from './operations';
import { step } from './pipeline';
import type { Step } from './steps';

describe('Operation / Prep classification', () => {
  it('classifies machine actions as Operations', () => {
    expect(OPERATION_TYPES).toEqual(['brew', 'steam', 'water', 'flush', 'weight']);
    for (const t of OPERATION_TYPES) {
      expect(isOperationType(t)).toBe(true);
      expect(isPrepType(t)).toBe(false);
    }
  });

  it('classifies user setup steps as Prep activities', () => {
    expect(PREP_TYPES).toEqual(['bean-selection', 'profile-selection', 'grind']);
    for (const t of PREP_TYPES) {
      expect(isPrepType(t)).toBe(true);
      expect(isOperationType(t)).toBe(false);
    }
  });
});

describe('step() builder', () => {
  it('produces a correctly-typed Step', () => {
    const brew: Step = step('brew', { durationSec: 30, targetYieldGrams: 36 });
    expect(brew.type).toBe('brew');
    expect(brew.config).toEqual({ durationSec: 30, targetYieldGrams: 36 });
  });

  it('produces prep Steps too', () => {
    const grind: Step = step('grind', { grinderId: 'niche-zero', grinderSetting: 17 });
    expect(grind.type).toBe('grind');
    expect(grind.config.grinderSetting).toBe(17);
  });
});
