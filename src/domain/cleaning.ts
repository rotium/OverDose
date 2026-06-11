/**
 * A Cleaning: a configured machine-maintenance routine, modeled like a Recipe
 * (a Library entity with local-first storage, an editor, home surfacing, and
 * reminders). See docs/plans/cleaning-feature.md.
 *
 * Two modes:
 *   - **Clean** — a user-composed, reorderable list of `CleanStep`s covering
 *     the *surface* ops: coffee-side (forward-flush), flush, steam-wand, and a
 *     passive steam-wand soak. Real cleaning is multi-pass (Cafiza forward-flush
 *     → rinse pass → flush → steam wand), so the sequence is user-built.
 *   - **Descale** — a separate, FIXED (app-owned) operation: citric acid through
 *     the internals + steam scale path. Not composable (safety-critical).
 *
 * Chemicals never cross paths: Cafiza → blind basket (coffee-side), Rinza →
 * milk jug (steam wand), citric → water tank (descale).
 */
export type CleanStepType =
  | 'coffeeSide'
  | 'flush'
  | 'steamWand'
  | 'steamWandSoak'
  | 'waterTank'
  | 'thimble';

export type CleanStep =
  | { id: string; type: 'coffeeSide'; profileId?: string; withChemical?: boolean }
  | { id: string; type: 'flush'; seconds?: number }
  | { id: string; type: 'steamWand'; withChemical?: boolean; seconds?: number }
  | { id: string; type: 'steamWandSoak'; minutes?: number } // soak tip + needle
  | { id: string; type: 'waterTank' } // wash the water tank
  | { id: string; type: 'thimble'; minutes?: number }; // soak uptake in citric

/** Default flush duration (s) — the wizard stops the flush after this. */
export const DEFAULT_FLUSH_SECONDS = 5;
/** Default steam duration (s) for a steam-wand run — wizard stops it after this. */
export const DEFAULT_STEAM_SECONDS = 30;
/** Default soak-timer durations (min). */
export const DEFAULT_TIP_SOAK_MIN = 60;
export const DEFAULT_THIMBLE_MIN = 30;

export type CleaningKind = 'clean' | 'descale';

export type CleaningOperation =
  | { kind: 'clean'; steps: CleanStep[] }
  | { kind: 'descale'; withChemical?: boolean };

export type ReminderUnit = 'day' | 'week' | 'month';

/**
 * A reminder schedule — a fixed **calendar grid** ("every X unit at <slot>,
 * <time>"), not a relative "N days since last done". `anchor` is the first
 * occurrence; the grid repeats every `every·unit` from there. See cleaningDue /
 * computeFirstOccurrence and docs/plans/cleaning-feature.md.
 */
export interface Reminder {
  /** Interval count (≥ 1). */
  every: number;
  unit: ReminderUnit;
  /** Time of day the occurrence fires, "HH:MM" (24h). */
  atTime: string;
  /** 0=Sun … 6=Sat — the slot weekday when `unit === 'week'`. */
  weekday?: number;
  /** 1–31 — the slot day-of-month when `unit === 'month'` (clamped to month length). */
  dayOfMonth?: number;
  /** ISO timestamp of the first occurrence. Recomputed whenever the spec changes. */
  anchor: string;
}

export interface Cleaning {
  id: string;
  name: string;
  operation: CleaningOperation;
  /**
   * Reminder schedule (calendar grid). Absent means no reminders. "Due" when an
   * occurrence has passed since the last acknowledgement (`lastDoneAt`); sticky
   * until acknowledged. Acknowledge = run the cleaning *or* Reset reminder.
   */
  reminder?: Reminder;
  /** Personal note. */
  notes?: string;
  /** Hidden from the Home quick-buttons when true (mirrors `Recipe.hidden`).
   *  Cleanings show on Home by default; still listed/runnable in Maintenance. */
  hidden?: boolean;
  order?: number;
  /** ISO timestamp of the last acknowledgement — wizard completion or Reset.
   *  This is the clock `cleaningDue` compares occurrences against. */
  lastDoneAt?: string;
}

// ── Reminder constants ───────────────────────────────────────────────────────

export const REMINDER_UNITS: ReminderUnit[] = ['day', 'week', 'month'];

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export const reminderUnitLabel = (unit: ReminderUnit, count = 1): string =>
  `${unit}${count === 1 ? '' : 's'}`;

/** Default spec used when reminders are first switched on (weekly, Monday 09:00). */
export const DEFAULT_REMINDER: Omit<Reminder, 'anchor'> = {
  every: 1,
  unit: 'week',
  weekday: 1,
  atTime: '09:00',
};

// ── Kinds ──────────────────────────────────────────────────────────────────

export const CLEANING_KINDS: CleaningKind[] = ['clean', 'descale'];

export const cleaningKindLabel = (kind: CleaningKind): string =>
  kind === 'clean' ? 'Clean' : 'Descale';

/** The descale chemical toggle label. */
export const DESCALE_CHEMICAL_LABEL = 'Citric acid in the tank';

// ── Clean steps ──────────────────────────────────────────────────────────────

export const CLEAN_STEP_TYPES: CleanStepType[] = [
  'coffeeSide',
  'flush',
  'steamWand',
  'steamWandSoak',
  'waterTank',
  'thimble',
];

export const cleanStepLabel = (type: CleanStepType): string => {
  switch (type) {
    case 'coffeeSide':
      return 'Group head';
    case 'flush':
      return 'Flush';
    case 'steamWand':
      return 'Steam wand';
    case 'steamWandSoak':
      return 'Steam-tip soak';
    case 'waterTank':
      return 'Water tank';
    case 'thimble':
      return 'Thimble';
  }
};

/** Steps with a meaningful chemical choice (coffee-side → Cafiza, steam-wand → Rinza). */
export const stepUsesChemical = (type: CleanStepType): boolean =>
  type === 'coffeeSide' || type === 'steamWand';

/** Chemical-toggle label for a chemical step. */
export const stepChemicalLabel = (type: CleanStepType): string =>
  type === 'coffeeSide' ? 'Cafiza in the blind basket' : 'Rinza in the jug';

/** A fresh step of the given type with default config + a stable id. */
export const newCleanStep = (type: CleanStepType): CleanStep => {
  const id = crypto.randomUUID();
  switch (type) {
    case 'coffeeSide':
      return { id, type, withChemical: false };
    case 'steamWand':
      return { id, type, withChemical: false, seconds: DEFAULT_STEAM_SECONDS };
    case 'flush':
      return { id, type, seconds: DEFAULT_FLUSH_SECONDS };
    case 'steamWandSoak':
      return { id, type, minutes: DEFAULT_TIP_SOAK_MIN };
    case 'thimble':
      return { id, type, minutes: DEFAULT_THIMBLE_MIN };
    case 'waterTank':
      return { id, type };
  }
};

// ── Summaries + prep ─────────────────────────────────────────────────────────

/** One-line summary of an operation for list rows. */
export const operationSummary = (op: CleaningOperation): string => {
  if (op.kind === 'descale') return 'Citric acid · internals + steam';
  const areas: string[] = [];
  const add = (a: string) => {
    if (!areas.includes(a)) areas.push(a);
  };
  for (const s of op.steps ?? []) {
    if (s.type === 'coffeeSide') add('Group head');
    else if (s.type === 'flush') add('Flush');
    else if (s.type === 'steamWand' || s.type === 'steamWandSoak') add('Steam wand');
    else if (s.type === 'waterTank') add('Tank');
    else if (s.type === 'thimble') add('Thimble');
  }
  return areas.length ? areas.join(' · ') : 'No steps';
};

/**
 * Per-step prep guidance (app-authored, incl. safety) — surfaced by the wizard
 * before each step runs. Read-only; never user-editable.
 */
export const deriveStepPrep = (step: CleanStep): string[] => {
  switch (step.type) {
    case 'coffeeSide':
      return step.withChemical
        ? [
            'Insert the blind basket + ~3 g Cafiza.',
            '⚠ Never put detergent in the water tank.',
            'Runs the forward-flush profile, then flush until clear.',
          ]
        : ['Insert the blind basket (no detergent).', 'Forward-flush rinse.'];
    case 'flush':
      return ['Plain hot-water rinse of the group.'];
    case 'steamWand':
      return step.withChemical
        ? [
            'Fill a jug: ~30 ml Rinza + 500 ml water. Submerge the steam tip.',
            '⚠ Rinza only in the jug — never the tank.',
            'Steam to clear milk residue, then rinse with clean water.',
          ]
        : ['Fill a jug with clean water; submerge the tip.', 'Steam to flush the wand.'];
    // Soak/manual steps: prep shows only the "start" action (the deferred
    // finish is collected into the wizard's closing step — see deriveStepFinish).
    case 'steamWandSoak':
      return [
        'Remove the steam tip and drop it in hot water (NOT citric) — do not steam.',
      ];
    case 'waterTank':
      return ['Remove the water tank and wash it with soap & water (dishwasher-safe).'];
    case 'thimble':
      return ['Pull out the water-uptake thimble and drop it in 5% citric acid.'];
  }
};

/**
 * Deferred "finish" actions for soak/manual steps — collected into the wizard's
 * closing step (done after the soak timer chimes). Empty for machine steps.
 */
export const deriveStepFinish = (step: CleanStep): string[] => {
  switch (step.type) {
    case 'steamWandSoak':
      return [
        'Steam tip — poke a needle through the hole, check it’s clear against the light, wash, and refit.',
      ];
    case 'waterTank':
      return ['Refill the water tank and return it.'];
    case 'thimble':
      return ['Thimble — rinse it and refit it.'];
    default:
      return [];
  }
};

/** Soak-timer contribution (s) a step starts when reached, or undefined. */
export const stepTimerSec = (step: CleanStep): number | undefined => {
  if (step.type === 'steamWandSoak') {
    return (step.minutes ?? DEFAULT_TIP_SOAK_MIN) * 60;
  }
  if (step.type === 'thimble') {
    return (step.minutes ?? DEFAULT_THIMBLE_MIN) * 60;
  }
  return undefined;
};

/** Descale prep guidance (fixed, app-owned). */
export const deriveDescalePrep = (op: {
  kind: 'descale';
  withChemical?: boolean;
}): string[] =>
  op.withChemical
    ? [
        'Disable the steam heater and let it cool first.',
        'Citric acid 5% in the tank (~1540 ml : 80 g). Use soft/distilled water.',
        '⚠ Citric acid only — others void warranty. v1.0/v1.1: never above 5%.',
        'Take the steam tip off; place a container under the group + wand.',
        'Then rinse until there is no acidic taste.',
      ]
    : [
        'Fresh water in the tank — no chemical.',
        'Water-only rinse pass through the internals + steam path.',
      ];

// ── Reminder occurrences / due ───────────────────────────────────────────────

const DAY_MS = 86_400_000;

const formatDuration = (ms: number): string => {
  const days = ms / DAY_MS;
  if (days >= 1) {
    const d = Math.round(days);
    return `${d} day${d === 1 ? '' : 's'}`;
  }
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  return `${hours} h`;
};

const daysInMonth = (year: number, month: number): number =>
  new Date(year, month + 1, 0).getDate();

const parseHM = (t: string): [number, number] => {
  const [h, m] = t.split(':');
  return [Number(h) || 0, Number(m) || 0];
};

/** The k-th occurrence timestamp (k may be 0). Day/week step by a fixed span;
 *  month steps by calendar months, preserving the slot day (clamped). */
export const nthOccurrence = (r: Reminder, k: number): number => {
  const a = Date.parse(r.anchor);
  if (r.unit === 'day') return a + k * r.every * DAY_MS;
  if (r.unit === 'week') return a + k * r.every * 7 * DAY_MS;
  const d = new Date(a);
  const t = new Date(d.getFullYear(), d.getMonth() + k * r.every, 1, d.getHours(), d.getMinutes(), 0, 0);
  t.setDate(Math.min(d.getDate(), daysInMonth(t.getFullYear(), t.getMonth())));
  return t.getTime();
};

/** Index of the latest occurrence ≤ now, or -1 if now is before the first. */
const indexAtOrBefore = (r: Reminder, now: number): number => {
  const a = Date.parse(r.anchor);
  if (now < a) return -1;
  if (r.unit === 'month') {
    const an = new Date(a);
    const nw = new Date(now);
    let k = Math.floor(
      (nw.getFullYear() * 12 + nw.getMonth() - (an.getFullYear() * 12 + an.getMonth())) /
        r.every,
    );
    if (k < 0) k = 0;
    while (k > 0 && nthOccurrence(r, k) > now) k--;
    while (nthOccurrence(r, k + 1) <= now) k++;
    return k;
  }
  const step = (r.unit === 'day' ? r.every : r.every * 7) * DAY_MS;
  return Math.floor((now - a) / step);
};

/** The next occurrence strictly after `now`. */
export const nextOccurrence = (r: Reminder, now: number): number => {
  const k = indexAtOrBefore(r, now);
  return k < 0 ? nthOccurrence(r, 0) : nthOccurrence(r, k + 1);
};

/**
 * The occurrence currently making a cleaning due — the latest passed slot that's
 * newer than the last acknowledgement — or undefined when not due. The chime
 * de-dupes on this value (one ping per occurrence).
 */
export const dueOccurrence = (c: Cleaning, now: number): number | undefined => {
  const r = c.reminder;
  if (!r) return undefined;
  const k = indexAtOrBefore(r, now);
  if (k < 0) return undefined;
  const prev = nthOccurrence(r, k);
  const lastAck = c.lastDoneAt ? Date.parse(c.lastDoneAt) : -Infinity;
  return prev > lastAck ? prev : undefined;
};

/**
 * First occurrence at or after `from` for a spec (no anchor yet), as ISO. Called
 * on save/edit to (re)anchor the grid.
 */
export const computeFirstOccurrence = (
  spec: Omit<Reminder, 'anchor'>,
  from: number,
): string => {
  const [hh, mm] = parseHM(spec.atTime);
  const b = new Date(from);
  if (spec.unit === 'day') {
    const c = new Date(b.getFullYear(), b.getMonth(), b.getDate(), hh, mm, 0, 0);
    if (c.getTime() < from) c.setDate(c.getDate() + 1);
    return c.toISOString();
  }
  if (spec.unit === 'week') {
    const wd = spec.weekday ?? 0;
    const c = new Date(b.getFullYear(), b.getMonth(), b.getDate(), hh, mm, 0, 0);
    let delta = (wd - c.getDay() + 7) % 7;
    if (delta === 0 && c.getTime() < from) delta = 7;
    c.setDate(c.getDate() + delta);
    return c.toISOString();
  }
  const dom = spec.dayOfMonth ?? 1;
  const make = (y: number, m: number): Date =>
    new Date(y, m, Math.min(dom, daysInMonth(y, m)), hh, mm, 0, 0);
  let y = b.getFullYear();
  let m = b.getMonth();
  let c = make(y, m);
  if (c.getTime() < from) {
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
    c = make(y, m);
  }
  return c.toISOString();
};

/** Absolute "Fri Jun 13, 15:00"-style label — used by the editor's Next preview. */
export const formatOccurrence = (ms: number): string => {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${WEEKDAY_LABELS[d.getDay()]} ${MONTH_LABELS[d.getMonth()]} ${d.getDate()}, ${hh}:${mm}`;
};

export interface CleaningDue {
  due: boolean;
  /** Short forward-looking label, e.g. "Next in 3 days" / "Due now" / "Overdue 2 days". */
  label: string;
}

/**
 * Compute reminder state from the calendar grid. Due when an occurrence has
 * passed since `lastDoneAt`; otherwise a forward-looking "Next in …" label.
 */
export const cleaningDue = (c: Cleaning, opts: { now: number }): CleaningDue => {
  const r = c.reminder;
  if (!r) return { due: false, label: 'No reminder' };
  const occ = dueOccurrence(c, opts.now);
  if (occ !== undefined) {
    const overdue = opts.now - occ;
    return {
      due: true,
      label: overdue >= DAY_MS ? `Overdue ${formatDuration(overdue)}` : 'Due now',
    };
  }
  return { due: false, label: `Next in ${formatDuration(nextOccurrence(r, opts.now) - opts.now)}` };
};
