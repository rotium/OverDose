import { describe, expect, it } from 'vitest';
import {
  cleaningDue,
  computeFirstOccurrence,
  deriveDescalePrep,
  deriveStepPrep,
  dueOccurrence,
  nextOccurrence,
  nthOccurrence,
  operationSummary,
  type Cleaning,
  type Reminder,
} from './cleaning';

const clean = (reminder?: Reminder, lastDoneAt?: string): Cleaning => ({
  id: 'c1',
  name: 'X',
  operation: { kind: 'clean', steps: [] },
  reminder,
  lastDoneAt,
});

// Local-time constructors so anchor + now share the runner's timezone.
const ms = (y: number, mo: number, d: number, h = 9, mi = 0): number =>
  new Date(y, mo, d, h, mi, 0, 0).getTime();
const isoAt = (y: number, mo: number, d: number, h = 9, mi = 0): string =>
  new Date(y, mo, d, h, mi, 0, 0).toISOString();
// 2026: Jan 1 = Thu, Jan 2 = Fri, Jan 5 = Mon; not a leap year (Feb = 28d).
const weekly: Reminder = {
  every: 1,
  unit: 'week',
  weekday: 5,
  atTime: '15:00',
  anchor: isoAt(2026, 0, 2, 15, 0),
};

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

  it('steam purge tells you to wipe the wand with a rag', () => {
    const p = deriveStepPrep({ id: 's', type: 'steamPurge' });
    expect(p.join(' ')).toMatch(/purge/i);
    expect(p.join(' ')).toMatch(/wipe.*rag/i);
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

describe('occurrence math', () => {
  it('weekly grid steps by every·7 days', () => {
    const r: Reminder = { ...weekly, every: 2 };
    expect(nthOccurrence(r, 1)).toBe(ms(2026, 0, 16, 15, 0));
    expect(nthOccurrence(r, 2)).toBe(ms(2026, 0, 30, 15, 0));
  });

  it('monthly grid steps by calendar months, preserving the day', () => {
    const r: Reminder = {
      every: 1,
      unit: 'month',
      dayOfMonth: 1,
      atTime: '08:00',
      anchor: isoAt(2026, 0, 1, 8, 0),
    };
    expect(nthOccurrence(r, 1)).toBe(ms(2026, 1, 1, 8, 0));
    expect(nthOccurrence(r, 2)).toBe(ms(2026, 2, 1, 8, 0));
  });

  it('monthly clamps a day past the month length (Jan 31 → Feb 28)', () => {
    const r: Reminder = {
      every: 1,
      unit: 'month',
      dayOfMonth: 31,
      atTime: '09:00',
      anchor: isoAt(2026, 0, 31, 9, 0),
    };
    expect(nthOccurrence(r, 1)).toBe(ms(2026, 1, 28, 9, 0));
  });

  it('nextOccurrence returns the next future slot', () => {
    expect(nextOccurrence(weekly, ms(2026, 0, 5, 12, 0))).toBe(ms(2026, 0, 9, 15, 0));
  });
});

describe('computeFirstOccurrence', () => {
  it('daily: today at the time if still ahead, else tomorrow', () => {
    expect(computeFirstOccurrence({ every: 1, unit: 'day', atTime: '08:00' }, ms(2026, 0, 10, 7, 0)))
      .toBe(isoAt(2026, 0, 10, 8, 0));
    expect(computeFirstOccurrence({ every: 1, unit: 'day', atTime: '08:00' }, ms(2026, 0, 10, 9, 0)))
      .toBe(isoAt(2026, 0, 11, 8, 0));
  });

  it('weekly: snaps forward to the next matching weekday', () => {
    // from Mon Jan 5 → next Friday is Jan 9
    expect(
      computeFirstOccurrence({ every: 1, unit: 'week', weekday: 5, atTime: '15:00' }, ms(2026, 0, 5, 9, 0)),
    ).toBe(isoAt(2026, 0, 9, 15, 0));
  });

  it('monthly: clamps to month length', () => {
    expect(
      computeFirstOccurrence({ every: 1, unit: 'month', dayOfMonth: 31, atTime: '09:00' }, ms(2026, 1, 1, 9, 0)),
    ).toBe(isoAt(2026, 1, 28, 9, 0));
  });
});

describe('cleaningDue', () => {
  it('no reminder → not due', () => {
    expect(cleaningDue(clean(), { now: ms(2026, 0, 10) })).toEqual({
      due: false,
      label: 'No reminder',
    });
  });

  it('before the first occurrence → not due, forward label', () => {
    const r: Reminder = { ...weekly, anchor: isoAt(2026, 0, 9, 15, 0) };
    const d = cleaningDue(clean(r), { now: ms(2026, 0, 5, 9, 0) });
    expect(d.due).toBe(false);
    expect(d.label).toMatch(/Next in/);
  });

  it('an occurrence has passed since lastDone → due', () => {
    const d = cleaningDue(clean(weekly, isoAt(2026, 0, 3, 10, 0)), { now: ms(2026, 0, 9, 16, 0) });
    expect(d.due).toBe(true);
  });

  it('acknowledged after the latest occurrence → not due', () => {
    const d = cleaningDue(clean(weekly, isoAt(2026, 0, 9, 15, 30)), { now: ms(2026, 0, 9, 16, 0) });
    expect(d.due).toBe(false);
    expect(d.label).toMatch(/Next in/);
  });

  it('a brand-new reminder is not "due now" — it waits for the first occurrence', () => {
    const r: Reminder = { every: 1, unit: 'day', atTime: '08:00', anchor: isoAt(2026, 0, 11, 8, 0) };
    expect(cleaningDue(clean(r), { now: ms(2026, 0, 10, 9, 0) }).due).toBe(false);
  });

  it('off-schedule completion does not pre-clear a future occurrence', () => {
    // cleaned Wed Jan 7; the Fri Jan 9 occurrence still fires
    const d = cleaningDue(clean(weekly, isoAt(2026, 0, 7, 10, 0)), { now: ms(2026, 0, 9, 16, 0) });
    expect(d.due).toBe(true);
  });

  it('overdue past a day reads "Overdue …"', () => {
    const d = cleaningDue(clean(weekly, isoAt(2026, 0, 3, 10, 0)), { now: ms(2026, 0, 11, 16, 0) });
    expect(d.label).toMatch(/Overdue/);
  });
});

describe('dueOccurrence', () => {
  it('returns the passed slot that makes it due (chime key)', () => {
    expect(dueOccurrence(clean(weekly), ms(2026, 0, 9, 16, 0))).toBe(ms(2026, 0, 9, 15, 0));
  });

  it('returns undefined when not due', () => {
    expect(dueOccurrence(clean(weekly, isoAt(2026, 0, 9, 15, 30)), ms(2026, 0, 9, 16, 0))).toBeUndefined();
  });
});
