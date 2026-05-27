import { routineStep, type Recipe, type Routine } from './domain';
import type { ProfileRecord, WorkflowSnapshot } from './api';
import type { BrewBundle } from './components/RecipeBrewScreen';

export const EXPLORE_BREW_RECIPE_ID = 'explore-brew';

const norm = (s: string | undefined): string => (s ?? '').trim().toLowerCase();

/**
 * Build the one-off brew that the Explore "Brew" tile runs. There's no saved
 * Recipe — the "last used" setup is just the gateway's current workflow, so
 * we seed dose + yield from `workflow.context` and resolve the workflow's
 * profile *title* to a real `profileId` against the gateway's profile list
 * (the machine already has that profile loaded, so this is just so the prep
 * card shows it; an unmatched/absent title leaves it unset and the brew runs
 * whatever profile is loaded).
 *
 * The routine is a synthetic single brew step so `RecipeBrewScreen` runs its
 * normal prep → live → summary pipeline via `bundleOverride`.
 */
export const buildExploreBrewBundle = (
  workflow: WorkflowSnapshot | null,
  profiles: ProfileRecord[],
): BrewBundle => {
  const ctx = workflow?.context;
  const title = workflow?.profile?.title;
  const profileId = title
    ? profiles.find((pr) => norm(pr.profile.title) === norm(title))?.id
    : undefined;

  const routine: Routine = {
    id: 'explore-brew-routine',
    name: 'Brew',
    steps: [routineStep('brew', {}, 'explore-brew-step')],
  };
  const recipe: Recipe = {
    id: EXPLORE_BREW_RECIPE_ID,
    name: 'Espresso',
    routineId: routine.id,
    doseGrams:
      typeof ctx?.targetDoseWeight === 'number' ? ctx.targetDoseWeight : undefined,
    targetYieldGrams:
      typeof ctx?.targetYield === 'number' && ctx.targetYield > 0
        ? ctx.targetYield
        : undefined,
    profileId,
    overrides: {},
  };
  return { recipe, routine };
};
