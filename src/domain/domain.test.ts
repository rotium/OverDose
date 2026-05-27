import { describe, it, expect } from 'vitest';
import { STEP_TYPES } from './operations';
import { routineStep, type RoutineStep } from './routine';

describe('STEP_TYPES', () => {
  it('enumerates exactly the four machine-action types', () => {
    expect(STEP_TYPES).toEqual(['brew', 'steam', 'water', 'flush']);
  });
});

describe('routineStep() builder', () => {
  it('produces brew steps with an empty Routine-level config', () => {
    const brew: RoutineStep = routineStep('brew', {});
    expect(brew.type).toBe('brew');
    expect(brew.config).toEqual({});
    expect(typeof brew.id).toBe('string');
    expect(brew.id.length).toBeGreaterThan(0);
  });

  it('produces steam steps with an empty Routine-level config', () => {
    const steam: RoutineStep = routineStep('steam', {});
    expect(steam.type).toBe('steam');
    expect(steam.config).toEqual({});
  });

  it('honours an explicitly-passed id (for seed data stability)', () => {
    const s = routineStep('brew', {}, 'seed-step-brew');
    expect(s.id).toBe('seed-step-brew');
  });
});
