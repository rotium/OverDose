/**
 * A Cleaning: a configured machine-maintenance routine, modeled like a Recipe
 * (a Library entity with local-first storage, an editor, home surfacing, and
 * reminders). See docs/plans/cleaning-feature.md.
 *
 * A DE1 has four distinct cleaning operations — different chemicals, plumbing,
 * and targets — captured by the `kind` discriminator:
 *
 *   - `profile`  — a *cleaning profile* (e.g. "Cleaning/Forward Flush x5"),
 *                  run through the brew engine. Optional Cafiza detergent in a
 *                  blind basket. Cleans the shower screen + lower group.
 *   - `clean`    — firmware `clean` state. Citric acid in the tank (or
 *                  water-only). Cleans upper brass + flush valve + light
 *                  internal descale.
 *   - `descale`  — firmware `descale` state. Citric acid in the tank (or
 *                  water-only). Everything `clean` does + the steam path.
 *   - `flush`    — firmware hot-water rinse. No chemical, no basket.
 *
 * `withChemical` is kind-aware: for `profile` it means Cafiza in the blind
 * basket; for `clean`/`descale` it means citric acid in the tank (vs a
 * water-only flush). It never crosses paths — detergent only ever goes in the
 * basket, citric only ever in the tank.
 */
export type CleaningKind = 'profile' | 'clean' | 'descale' | 'flush';

export type CleaningOperation =
  | { kind: 'profile'; profileId?: string; withChemical?: boolean }
  | { kind: 'clean'; withChemical?: boolean }
  | { kind: 'descale'; withChemical?: boolean }
  | { kind: 'flush' };

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
  /** Personal note appended below the (derived, read-only) prep guidance. */
  notes?: string;
  /**
   * Hidden from the Home quick-buttons when true (mirrors `Recipe.hidden`).
   * Cleanings show on Home by default; this drops one off without deleting it.
   * Still fully editable + runnable; the Library shows hidden cleanings.
   */
  hidden?: boolean;
  order?: number;
  /** ISO timestamp of the last completion (wizard finish or manual reset). */
  lastDoneAt?: string;
  /** Espresso-shot total snapshot at last completion — baseline for `byShots`. */
  lastDoneShotCount?: number;
}

/** Human label for an operation kind (used in the editor's Operation select). */
export const cleaningKindLabel = (kind: CleaningKind): string => {
  switch (kind) {
    case 'profile':
      return 'Cleaning profile';
    case 'clean':
      return 'Clean (internal)';
    case 'descale':
      return 'Descale';
    case 'flush':
      return 'Flush';
  }
};

/** Whether this kind has a meaningful chemical choice (flush never does). */
export const kindUsesChemical = (kind: CleaningKind): boolean =>
  kind === 'profile' || kind === 'clean' || kind === 'descale';

/** The chemical-toggle label for a kind (kind-aware: basket vs tank). */
export const chemicalToggleLabel = (kind: CleaningKind): string =>
  kind === 'profile'
    ? 'Use chemical (Cafiza in the blind basket)'
    : 'Use citric acid (in the tank)';

const opWithChemical = (op: CleaningOperation): boolean =>
  op.kind !== 'flush' && op.withChemical === true;

export interface CleaningPrep {
  /** Bullet lines incl. the always-present safety warnings. Read-only. */
  lines: string[];
  /** Short duration hint, e.g. "~6 min + rinsing". */
  durationHint?: string;
}

/**
 * Derive the read-only prep guidance for an operation. App-authored so the
 * safety rules (detergent only in basket, citric only in tank) can't be edited
 * away. Shown in the editor as a preview and reused by the live wizard.
 */
export const derivePrep = (op: CleaningOperation): CleaningPrep => {
  const chem = opWithChemical(op);
  switch (op.kind) {
    case 'profile':
      return chem
        ? {
            lines: [
              'Blind basket + ~3 g Cafiza (espresso detergent).',
              '⚠ Never put detergent in the water tank.',
              'Runs ~5 pressure cycles, then flush until clear.',
            ],
            durationHint: '~90 s',
          }
        : {
            lines: [
              'Blind basket, no detergent.',
              'Deep rinse — ~5 pressure cycles.',
            ],
            durationHint: '~90 s',
          };
    case 'clean':
      return chem
        ? {
            lines: [
              'Citric acid 5% in the water tank.',
              '⚠ Citric acid only — never put detergent in the tank.',
              'Rinses the upper group + flush valve, then rinse with fresh water.',
            ],
            durationHint: '~2½ min',
          }
        : {
            lines: [
              'Fresh water in the tank — no chemical.',
              'Water-only internal flush of the upper group + flush valve.',
            ],
            durationHint: '~2½ min',
          };
    case 'descale':
      return chem
        ? {
            lines: [
              'Disable the steam heater and let it cool first.',
              'Citric acid 5% in the tank (~1540 ml : 80 g). Use soft/distilled water.',
              '⚠ Citric acid only — others void warranty. v1.0/v1.1 machines: never above 5%.',
              'Take the steam tip off; place a container under the group + wand.',
              'Then rinse until there is no acidic taste.',
            ],
            durationHint: '~6 min + rinsing',
          }
        : {
            lines: [
              'Fresh water in the tank — no chemical.',
              'Water-only rinse pass through the internals + steam path.',
            ],
            durationHint: '~6 min',
          };
    case 'flush':
      return {
        lines: ['Quick hot-water rinse of the group. No chemical, no basket.'],
        durationHint: '~5 s',
      };
  }
};

/** Short summary of a cleaning's operation for list rows, e.g. "Forward Flush · Cafiza". */
export const operationSummary = (op: CleaningOperation): string => {
  switch (op.kind) {
    case 'profile':
      return `Forward Flush · ${op.withChemical ? 'Cafiza' : 'no detergent'}`;
    case 'clean':
      return `Clean · ${op.withChemical ? 'citric acid' : 'water only'}`;
    case 'descale':
      return `Descale · ${op.withChemical ? 'citric acid' : 'water only'}`;
    case 'flush':
      return 'Flush · hot water';
  }
};

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
 * `byShots` contributes only when a live `totalShots` is supplied (the shot
 * total isn't wired into Settings yet — the Alerts component adds it); without
 * it, a shots threshold is reported statically ("every N shots") and doesn't
 * affect `due`.
 */
export const cleaningDue = (
  c: Cleaning,
  opts: { now: number; totalShots?: number },
): CleaningDue => {
  const byDays = c.cadence?.byDays;
  const byShots = c.cadence?.byShots;
  if (!byDays && !byShots) return { due: false, label: 'No reminder' };

  // Time dimension.
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

  // Shots dimension (live only when totalShots is known).
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

  const due = timeDue || shotsDue;
  if (due) return { due: true, label: 'Due now' };

  const label = [timeLabel, shotsLabel].filter(Boolean).join(' · ');
  return { due: false, label: label || 'No reminder' };
};
