import { describe, expect, it } from 'vitest';
import {
  cleaningDue,
  derivePrep,
  operationSummary,
  type Cleaning,
} from './cleaning';

const DAY = 86_400_000;
const base: Cleaning = {
  id: 'c1',
  name: 'X',
  operation: { kind: 'profile', withChemical: false },
};

describe('derivePrep', () => {
  it('forward-flush with chemical warns about the tank + names Cafiza', () => {
    const prep = derivePrep({ kind: 'profile', withChemical: true });
    expect(prep.lines.join(' ')).toMatch(/Cafiza/);
    expect(prep.lines.join(' ')).toMatch(/never put detergent in the water tank/i);
  });

  it('descale with citric warns citric-only + mentions the steam heater', () => {
    const prep = derivePrep({ kind: 'descale', withChemical: true });
    expect(prep.lines.join(' ')).toMatch(/citric acid only/i);
    expect(prep.lines.join(' ')).toMatch(/steam heater/i);
  });

  it('water-only clean shows no chemical and no citric warning', () => {
    const prep = derivePrep({ kind: 'clean', withChemical: false });
    expect(prep.lines.join(' ')).toMatch(/no chemical/i);
    expect(prep.lines.join(' ')).not.toMatch(/citric acid only/i);
  });
});

describe('operationSummary', () => {
  it('distinguishes detergent vs none for forward flush', () => {
    expect(operationSummary({ kind: 'profile', withChemical: true })).toBe(
      'Forward Flush · Cafiza',
    );
    expect(operationSummary({ kind: 'profile', withChemical: false })).toBe(
      'Forward Flush · no detergent',
    );
  });
});

describe('cleaningDue', () => {
  const now = 1_000 * DAY; // arbitrary fixed clock

  it('no cadence → not due, "No reminder"', () => {
    expect(cleaningDue(base, { now })).toEqual({ due: false, label: 'No reminder' });
  });

  it('byDays and never done → due now', () => {
    const c = { ...base, cadence: { byDays: 7 } };
    expect(cleaningDue(c, { now }).due).toBe(true);
  });

  it('byDays with a recent completion → not due, forward-looking label', () => {
    const c = {
      ...base,
      cadence: { byDays: 7 },
      lastDoneAt: new Date(now - 2 * DAY).toISOString(),
    };
    const r = cleaningDue(c, { now });
    expect(r.due).toBe(false);
    expect(r.label).toMatch(/Next in 5 days/);
  });

  it('byDays past the threshold → due now', () => {
    const c = {
      ...base,
      cadence: { byDays: 7 },
      lastDoneAt: new Date(now - 8 * DAY).toISOString(),
    };
    expect(cleaningDue(c, { now }).due).toBe(true);
  });

  it('byShots without a live total → static "every N shots", not due', () => {
    const c = { ...base, cadence: { byShots: 50 } };
    const r = cleaningDue(c, { now });
    expect(r.due).toBe(false);
    expect(r.label).toBe('every 50 shots');
  });

  it('byShots with a live total over the threshold → due', () => {
    const c = { ...base, cadence: { byShots: 50 }, lastDoneShotCount: 100 };
    expect(cleaningDue(c, { now, totalShots: 155 }).due).toBe(true);
  });
});
