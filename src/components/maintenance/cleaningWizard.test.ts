import { describe, expect, it } from 'vitest';
import { buildWizard } from './cleaningWizard';
import type { Cleaning, CleanStep } from '../../domain';

const clean = (steps: CleanStep[]): Cleaning => ({
  id: 'c1',
  name: 'X',
  operation: { kind: 'clean', steps },
});

describe('buildWizard', () => {
  it('lowers coffee-side to a single profile-run phase, flush to a run phase', () => {
    const phases = buildWizard(
      clean([
        { id: 's1', type: 'coffeeSide', withChemical: true },
        { id: 's2', type: 'flush' },
      ]),
    );
    expect(phases).toHaveLength(2);
    expect(phases[0]).toMatchObject({
      kind: 'run',
      target: 'espresso',
      op: { type: 'profile' },
    });
    // The prep lines ride on the run phase (Start runs the profile).
    expect(phases[0].kind === 'run' && phases[0].lines.join(' ')).toMatch(/blind basket/i);
    expect(phases[1]).toMatchObject({
      kind: 'run',
      target: 'flush',
      op: { type: 'flush' },
    });
  });

  it('flush carries its configured stop duration', () => {
    const phases = buildWizard(clean([{ id: 's1', type: 'flush', seconds: 12 }]));
    expect(phases[0]).toMatchObject({
      kind: 'run',
      target: 'flush',
      durationSec: 12,
    });
  });

  it('steam-wand soak is a real instruction phase (do not steam)', () => {
    const phases = buildWizard(clean([{ id: 's1', type: 'steamWandSoak' }]));
    expect(phases).toHaveLength(1);
    expect(phases[0].kind).toBe('instruction');
    expect(phases[0].kind === 'instruction' && phases[0].lines.join(' ')).toMatch(
      /do not steam/i,
    );
  });

  it('lowers waterTank + thimble to instruction phases (thimble suggests a timer)', () => {
    const phases = buildWizard(
      clean([
        { id: 't', type: 'thimble' },
        { id: 'w', type: 'waterTank' },
      ]),
    );
    expect(phases[0]).toMatchObject({ kind: 'instruction', title: 'Thimble' });
    expect(
      phases[0].kind === 'instruction' && phases[0].startsTimerSec,
    ).toBeGreaterThan(0);
    expect(phases[1]).toMatchObject({ kind: 'instruction', title: 'Water tank' });
    expect(
      phases[1].kind === 'instruction' && phases[1].startsTimerSec,
    ).toBeUndefined();
  });

  it('descale is a single placeholder instruction', () => {
    const phases = buildWizard({
      id: 'c1',
      name: 'Descale',
      operation: { kind: 'descale', withChemical: true },
    });
    expect(phases).toHaveLength(1);
    expect(phases[0]).toMatchObject({ kind: 'instruction', title: 'Descale' });
  });

  it('an empty clean yields a single "nothing to do" phase', () => {
    const phases = buildWizard(clean([]));
    expect(phases).toHaveLength(1);
    expect(phases[0].title).toBe('Nothing to do');
  });
});
