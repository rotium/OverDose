import { describe, expect, it } from 'vitest';
import {
  cleaningDue,
  deriveDescalePrep,
  deriveStepPrep,
  operationSummary,
  type Cleaning,
} from './cleaning';

const DAY = 86_400_000;
const clean = (cadence?: Cleaning['cadence'], lastDoneAt?: string): Cleaning => ({
  id: 'c1',
  name: 'X',
  operation: { kind: 'clean', steps: [] },
  cadence,
  lastDoneAt,
});

describe('deriveStepPrep', () => {
  it('coffee-side with chemical warns about the tank + names Cafiza', () => {
    const p = deriveStepPrep({ id: 's', type: 'coffeeSide', withChemical: true });
    expect(p.join(' ')).toMatch(/Cafiza/);
    expect(p.join(' ')).toMatch(/never put detergent in the water tank/i);
  });

  it('steam-wand with chemical names Rinza and warns jug-only', () => {
    const p = deriveStepPrep({ id: 's', type: 'steamWand', withChemical: true });
    expect(p.join(' ')).toMatch(/Rinza/);
    expect(p.join(' ')).toMatch(/never the tank/i);
  });

  it('steam-wand soak says do not steam', () => {
    const p = deriveStepPrep({ id: 's', type: 'steamWandSoak' });
    expect(p.join(' ')).toMatch(/do not steam/i);
  });
});

describe('deriveDescalePrep', () => {
  it('with citric warns citric-only + mentions the steam heater', () => {
    const p = deriveDescalePrep({ kind: 'descale', withChemical: true });
    expect(p.join(' ')).toMatch(/citric acid only/i);
    expect(p.join(' ')).toMatch(/steam heater/i);
  });
});

describe('operationSummary', () => {
  it('summarises the distinct areas a clean touches, in order', () => {
    expect(
      operationSummary({
        kind: 'clean',
        steps: [
          { id: '1', type: 'coffeeSide', withChemical: true },
          { id: '2', type: 'coffeeSide', withChemical: false },
          { id: '3', type: 'flush' },
          { id: '4', type: 'steamWand', withChemical: true },
          { id: '5', type: 'steamWandSoak' },
        ],
      }),
    ).toBe('Group head · Flush · Steam wand');
  });

  it('describes descale', () => {
    expect(operationSummary({ kind: 'descale', withChemical: true })).toBe(
      'Citric acid · internals + steam',
    );
  });
});

describe('cleaningDue', () => {
  const now = 1_000 * DAY;

  it('no cadence → not due', () => {
    expect(cleaningDue(clean(), { now })).toEqual({ due: false, label: 'No reminder' });
  });

  it('byDays and never done → due now', () => {
    expect(cleaningDue(clean({ byDays: 7 }), { now }).due).toBe(true);
  });

  it('byDays with a recent completion → forward-looking label', () => {
    const r = cleaningDue(clean({ byDays: 7 }, new Date(now - 2 * DAY).toISOString()), {
      now,
    });
    expect(r.due).toBe(false);
    expect(r.label).toMatch(/Next in 5 days/);
  });

  it('byShots without a live total → static label, not due', () => {
    const r = cleaningDue(clean({ byShots: 50 }), { now });
    expect(r.due).toBe(false);
    expect(r.label).toBe('every 50 shots');
  });

  it('byShots with a live total over threshold → due', () => {
    const c = { ...clean({ byShots: 50 }), lastDoneShotCount: 100 };
    expect(cleaningDue(c, { now, totalShots: 155 }).due).toBe(true);
  });
});
