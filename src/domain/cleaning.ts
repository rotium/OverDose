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

export interface Cleaning {
  id: string;
  name: string;
  operation: CleaningOperation;
  /**
   * Reminder cadence. "Due" when *either* threshold is crossed. Absent (or both
   * undefined) means no reminders. `byShots` counts espresso shots since the
   * last completion (the gateway excludes cleaning runs from the shot total).
   */
  cadence?: { byDays?: number; byShots?: number };
  /** Personal note. */
  notes?: string;
  /** Hidden from the Home quick-buttons when true (mirrors `Recipe.hidden`).
   *  Cleanings show on Home by default; still listed/runnable in Maintenance. */
  hidden?: boolean;
  order?: number;
  /** ISO timestamp of the last completion (wizard finish or manual reset). */
  lastDoneAt?: string;
  /** Espresso-shot total snapshot at last completion — baseline for `byShots`. */
  lastDoneShotCount?: number;
}

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
      return 'Coffee-side';
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
    if (s.type === 'coffeeSide') add('Coffee-side');
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
    case 'steamWandSoak':
      return [
        'Remove the steam tip and soak it in hot water (NOT citric) — do not steam.',
        'When the timer is up: poke a needle through the hole, hold it to the light to check it’s clear, wash, and refit.',
      ];
    case 'waterTank':
      return [
        'Remove the water tank, empty it, and wash with soap & water (dishwasher-safe).',
        'Rinse and refit.',
      ];
    case 'thimble':
      return [
        'Pull out the water-uptake thimble.',
        'Soak it in 5% citric acid (~30 min) to dissolve scale.',
        'When the timer is up: rinse and refit.',
      ];
  }
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

// ── Cadence / due ─────────────────────────────────────────────────────────────

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

export interface CleaningDue {
  due: boolean;
  /** Short forward-looking label, e.g. "Next in 3 days" / "Due now" / "Overdue 2 days". */
  label: string;
}

/**
 * Compute reminder state. Time (`byDays`) is evaluated live from `lastDoneAt`.
 * `byShots` contributes only when a live `totalShots` is supplied; without it a
 * shots threshold is reported statically ("every N shots") and doesn't affect
 * `due`.
 */
export const cleaningDue = (
  c: Cleaning,
  opts: { now: number; totalShots?: number },
): CleaningDue => {
  const byDays = c.cadence?.byDays;
  const byShots = c.cadence?.byShots;
  if (!byDays && !byShots) return { due: false, label: 'No reminder' };

  let timeDue = false;
  let timeLabel: string | undefined;
  if (byDays) {
    if (!c.lastDoneAt) {
      timeDue = true;
    } else {
      const elapsed = opts.now - Date.parse(c.lastDoneAt);
      const remaining = byDays * DAY_MS - elapsed;
      if (remaining <= 0) {
        timeDue = true;
        timeLabel = `Overdue ${formatDuration(-remaining)}`;
      } else {
        timeLabel = `Next in ${formatDuration(remaining)}`;
      }
    }
  }

  let shotsDue = false;
  let shotsLabel: string | undefined;
  if (byShots) {
    if (opts.totalShots === undefined || c.lastDoneShotCount === undefined) {
      shotsLabel = `every ${byShots} shots`;
    } else {
      const since = Math.max(0, opts.totalShots - c.lastDoneShotCount);
      const remaining = byShots - since;
      if (remaining <= 0) {
        shotsDue = true;
        shotsLabel = `${-remaining} shots over`;
      } else {
        shotsLabel = `in ${remaining} shots`;
      }
    }
  }

  if (timeDue || shotsDue) return { due: true, label: 'Due now' };
  const label = [timeLabel, shotsLabel].filter(Boolean).join(' · ');
  return { due: false, label: label || 'No reminder' };
};
