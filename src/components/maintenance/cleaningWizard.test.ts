import { describe, expect, it } from 'vitest';
import { buildWizard } from './cleaningWizard';
import type { Cleaning, CleanStep } from '../../domain';

const clean = (steps: CleanStep[]): Cleaning => ({
  id: 'c1',
  name: 'X',
  operation: { kind: 'clean', steps },
});

describe('buildWizard', () => {
  it('lowers coffee-side to an instruction and flush to a run phase', () => {
    const phases = buildWizard(
      clean([
        { id: 's1', type: 'coffeeSide', withChemical: true },
        { id: 's2', type: 'flush' },
      ]),
    );
    expect(phases).toHaveLength(2);
    expect(phases[0]).toMatchObject({ kind: 'instruction', title: 'Coffee-side' });
    expect(phases[1]).toMatchObject({ kind: 'run', title: 'Flush', target: 'flush' });
  });

  it('steam-wand soak is a real instruction phase (do not steam)', () => {
    const phases = buildWizard(clean([{ id: 's1', type: 'steamWandSoak' }]));
    expect(phases).toHaveLength(1);
    expect(phases[0].kind).toBe('instruction');
    expect(phases[0].kind === 'instruction' && phases[0].lines.join(' ')).toMatch(
      /do not steam/i,
    );
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
