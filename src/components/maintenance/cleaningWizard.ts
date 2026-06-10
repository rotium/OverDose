import type { Cleaning } from '../../domain';
import { cleanStepLabel, deriveStepPrep } from '../../domain';
import type { MachineState } from '../../snapshot';

/**
 * A lowered wizard phase. `buildWizard` expands a Cleaning's high-level steps
 * into the flat phase list the engine walks.
 *
 *   - `instruction` — guidance the user confirms with Next (no machine action).
 *   - `run` — request a machine state, then wait for it to finish (enter → leave
 *     the target state). Progress is monitored from the machine snapshot.
 *
 * Coffee-side (profile run + save/restore), steam-wand (steam run) and the
 * descale flow render as instruction placeholders for now — they land in the
 * next increments. See docs/plans/cleaning-feature.md.
 */
export type WizardPhase =
  | { id: string; kind: 'instruction'; title: string; lines: string[] }
  | { id: string; kind: 'run'; title: string; target: MachineState; lines: string[] };

const COMING_SOON = '(Running this from the wizard is coming soon.)';

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
    switch (s.type) {
      case 'coffeeSide':
        phases.push({
          id: `${s.id}-cs`,
          kind: 'instruction',
          title: cleanStepLabel(s.type),
          lines: [...deriveStepPrep(s), COMING_SOON],
        });
        break;
      case 'flush':
        phases.push({
          id: `${s.id}-flush`,
          kind: 'run',
          title: cleanStepLabel(s.type),
          target: 'flush',
          lines: deriveStepPrep(s),
        });
        break;
      case 'steamWand':
        phases.push({
          id: `${s.id}-sw`,
          kind: 'instruction',
          title: cleanStepLabel(s.type),
          lines: [...deriveStepPrep(s), COMING_SOON],
        });
        break;
      case 'steamWandSoak':
        phases.push({
          id: `${s.id}-soak`,
          kind: 'instruction',
          title: cleanStepLabel(s.type),
          lines: deriveStepPrep(s),
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
