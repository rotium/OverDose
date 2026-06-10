import type { Cleaning } from '../../domain';
import {
  DEFAULT_FLUSH_SECONDS,
  DEFAULT_STEAM_SECONDS,
  DEFAULT_THIMBLE_MIN,
  DEFAULT_TIP_SOAK_MIN,
  cleanStepLabel,
  deriveStepPrep,
} from '../../domain';
import type { MachineState } from '../../snapshot';

/**
 * A lowered wizard phase. `buildWizard` expands a Cleaning's high-level steps
 * into the flat phase list the engine walks.
 *
 *   - `instruction` — guidance the user confirms with Next (no machine action).
 *   - `run` — request a machine state, then wait for it to finish (enter → leave
 *     the target state). The `op` tells the engine how to begin: a plain state
 *     request (flush/steam) or a profile run (coffee-side: load the cleaning
 *     profile, run espresso, restore the prior workflow at the end).
 *
 * Descale renders as an instruction placeholder for now — its guided flow is a
 * later increment. See docs/plans/cleaning-feature.md.
 */
export type RunOp =
  | { type: 'flush' }
  | { type: 'steam' }
  | { type: 'profile'; profileId?: string };

export type WizardPhase =
  | {
      id: string;
      kind: 'instruction';
      title: string;
      lines: string[];
      /** Optional suggested timer (s) for long soaks — chimes on elapse. */
      timerSec?: number;
    }
  | {
      id: string;
      kind: 'run';
      title: string;
      target: MachineState;
      lines: string[];
      op: RunOp;
      /** Wizard-enforced stop after N seconds (flush). Profile/steam runs end
       *  on their own, so they leave this undefined. */
      durationSec?: number;
    };

export const buildWizard = (cleaning: Cleaning): WizardPhase[] => {
  const op = cleaning.operation;
  if (op.kind === 'descale') {
    return [
      {
        id: 'descale',
        kind: 'instruction',
        title: 'Descale',
        lines: ['The guided descale flow is coming soon.'],
      },
    ];
  }

  const phases: WizardPhase[] = [];
  for (const s of op.steps) {
    const label = cleanStepLabel(s.type);
    switch (s.type) {
      case 'coffeeSide':
        // One page: the prep lines + Start (Start runs the profile).
        phases.push({
          id: `${s.id}-run`,
          kind: 'run',
          title: label,
          target: 'espresso',
          lines: deriveStepPrep(s),
          op: { type: 'profile', profileId: s.profileId },
        });
        break;
      case 'flush':
        phases.push({
          id: `${s.id}-run`,
          kind: 'run',
          title: label,
          target: 'flush',
          lines: deriveStepPrep(s),
          op: { type: 'flush' },
          durationSec: s.seconds ?? DEFAULT_FLUSH_SECONDS,
        });
        break;
      case 'steamWand':
        // One page: the prep lines + Start.
        phases.push({
          id: `${s.id}-run`,
          kind: 'run',
          title: label,
          target: 'steam',
          lines: deriveStepPrep(s),
          op: { type: 'steam' },
          durationSec: s.seconds ?? DEFAULT_STEAM_SECONDS,
        });
        break;
      case 'steamWandSoak':
        phases.push({
          id: `${s.id}-soak`,
          kind: 'instruction',
          title: label,
          lines: deriveStepPrep(s),
          timerSec: (s.minutes ?? DEFAULT_TIP_SOAK_MIN) * 60,
        });
        break;
      case 'waterTank':
        phases.push({
          id: `${s.id}-tank`,
          kind: 'instruction',
          title: label,
          lines: deriveStepPrep(s),
        });
        break;
      case 'thimble':
        phases.push({
          id: `${s.id}-thimble`,
          kind: 'instruction',
          title: label,
          lines: deriveStepPrep(s),
          timerSec: (s.minutes ?? DEFAULT_THIMBLE_MIN) * 60,
        });
        break;
    }
  }

  if (phases.length === 0) {
    phases.push({
      id: 'empty',
      kind: 'instruction',
      title: 'Nothing to do',
      lines: ['This cleaning has no steps.'],
    });
  }
  return phases;
};
