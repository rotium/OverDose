import { describe, it, expect } from 'vitest';
import { STEP_TYPES } from './operations';
import { beverageStep, type BeverageStep } from './beverage';

describe('STEP_TYPES', () => {
  it('enumerates exactly the four machine-action types', () => {
    expect(STEP_TYPES).toEqual(['brew', 'steam', 'water', 'flush']);
  });
});

describe('beverageStep() builder', () => {
  it('produces brew steps with an empty Beverage-level config', () => {
    const brew: BeverageStep = beverageStep('brew', {});
    expect(brew.type).toBe('brew');
    expect(brew.config).toEqual({});
    expect(typeof brew.id).toBe('string');
    expect(brew.id.length).toBeGreaterThan(0);
  });

  it('produces steam steps with auto-purge config', () => {
    const steam: BeverageStep = beverageStep('steam', {
      autoPurgeTimeSec: 5,
    });
    expect(steam.type).toBe('steam');
    if (steam.type === 'steam') {
      expect(steam.config.autoPurgeTimeSec).toBe(5);
    }
  });

  it('honours an explicitly-passed id (for seed data stability)', () => {
    const s = beverageStep('brew', {}, 'seed-step-brew');
    expect(s.id).toBe('seed-step-brew');
  });
});
