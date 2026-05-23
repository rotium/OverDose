import { describe, it, expect } from 'vitest';
import {
  OPERATION_TYPES,
  PREP_TYPES,
  isOperationType,
  isPrepType,
} from './operations';
import { beverageStep, type BeverageStep } from './beverage';

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

describe('beverageStep() builder', () => {
  it('produces a correctly-typed step with an id', () => {
    const brew: BeverageStep = beverageStep('brew', {
      durationSec: 30,
      targetYieldGrams: 36,
    });
    expect(brew.type).toBe('brew');
    expect(brew.config).toEqual({ durationSec: 30, targetYieldGrams: 36 });
    expect(typeof brew.id).toBe('string');
    expect(brew.id.length).toBeGreaterThan(0);
  });

  it('produces prep steps with ids too', () => {
    const grind: BeverageStep = beverageStep('grind', {
      grinderId: 'niche-zero',
      grinderSetting: 17,
    });
    expect(grind.type).toBe('grind');
    if (grind.type === 'grind') {
      expect(grind.config.grinderSetting).toBe(17);
    }
  });

  it('honours an explicitly-passed id (for seed data stability)', () => {
    const s = beverageStep('weight', { targetGrams: 18 }, 'seed-step-weight');
    expect(s.id).toBe('seed-step-weight');
  });
});
