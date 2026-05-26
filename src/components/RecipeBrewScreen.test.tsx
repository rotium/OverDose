import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { RecipeBrewScreen, stepToGatewayState } from './RecipeBrewScreen';
import { WithRepositories } from '../test/repositories';
import {
  LocalBeverageRepository,
  LocalRecipeRepository,
} from '../repositories';
import { MemoryStorage } from '../test/memoryStorage';
import { beverageStep } from '../domain';
import type { Beverage, Recipe } from '../domain';
import type { MachineSnapshot, MachineState } from '../snapshot';
import type { ProfileRecord } from '../api';
import type { WsStream } from '../streams';

interface SeedOpts {
  beverages: Beverage[];
  recipes: Recipe[];
}

const seedRepos = ({ beverages, recipes }: SeedOpts) => {
  const bStore = new MemoryStorage();
  bStore.setItem('starter-skin.beverages.v1', JSON.stringify(beverages));
  bStore.setItem('starter-skin.beverages.seeded.v1', '1');
  const rStore = new MemoryStorage();
  rStore.setItem('starter-skin.recipes.v1', JSON.stringify(recipes));
  rStore.setItem('starter-skin.recipes.seeded.v1', '1');
  return {
    beverages: new LocalBeverageRepository(bStore),
    recipes: new LocalRecipeRepository(rStore),
  };
};

const snapshotWithState = (state: MachineState): MachineSnapshot =>
  ({
    timestamp: '2026-05-24T00:00:00Z',
    state: { state, substate: 'idle' },
    flow: 0,
    pressure: 0,
    targetFlow: 0,
    targetPressure: 0,
    mixTemperature: 0,
    groupTemperature: 0,
    targetMixTemperature: 0,
    targetGroupTemperature: 0,
    profileFrame: 0,
    steamTemperature: 0,
  }) as MachineSnapshot;

const mkSetup = (opts: SeedOpts) => {
  const repos = seedRepos(opts);
  const [machineSnap, setMachineSnap] = createSignal<MachineSnapshot | null>(
    null,
  );
  const machineStream: WsStream<MachineSnapshot> = {
    latest: machineSnap,
    status: createSignal<'open'>('open')[0],
  };
  const requestState = vi.fn(async (_state: MachineState) => {});
  const onExit = vi.fn();

  return { repos, machineStream, setMachineSnap, requestState, onExit };
};

const renderScreen = (
  opts: SeedOpts & {
    recipeId?: string;
    loadProfileById?: (id: string) => Promise<ProfileRecord | null>;
    loadProfiles?: () => Promise<ProfileRecord[]>;
  },
): ReturnType<typeof mkSetup> & {
  onApplyWorkflow: ReturnType<typeof vi.fn>;
} => {
  const env = mkSetup({ beverages: opts.beverages, recipes: opts.recipes });
  // Default profile fetchers return empty/null so the brew-step prep card
  // never hits the real api in tests; callers that need a profile-loaded
  // assertion pass their own.
  const loadProfileById =
    opts.loadProfileById ?? (() => Promise.resolve<ProfileRecord | null>(null));
  const loadProfiles =
    opts.loadProfiles ?? (() => Promise.resolve<ProfileRecord[]>([]));
  const onApplyWorkflow = vi.fn(async () => {});
  render(() => (
    <WithRepositories beverages={env.repos.beverages} recipes={env.repos.recipes}>
      <RecipeBrewScreen
        recipeId={opts.recipeId ?? 'rec-1'}
        onExit={env.onExit}
        machineStream={() => env.machineStream}
        requestState={env.requestState}
        loadProfileById={loadProfileById}
        loadProfiles={loadProfiles}
        onApplyWorkflow={onApplyWorkflow}
      />
    </WithRepositories>
  ));
  return { ...env, onApplyWorkflow };
};

const mkProfileRecord = (
  over: Partial<ProfileRecord> = {},
): ProfileRecord => ({
  id: over.id ?? 'profile:abc',
  profile: over.profile ?? { title: 'Best Practice C+' },
  metadataHash: 'm',
  compoundHash: 'c',
  parentId: null,
  visibility: 'visible',
  isDefault: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

const cappuccino = (): Beverage => ({
  id: 'bev-cap',
  name: 'Cappuccino',
  steps: [
    beverageStep('brew', {}, 'step-brew'),
    beverageStep('flush', {}, 'step-flush'),
    beverageStep('steam', {}, 'step-steam'),
  ],
});

const sampleRecipe = (over: Partial<Recipe> = {}): Recipe => ({
  id: 'rec-1',
  name: "Wife's",
  beverageId: 'bev-cap',
  overrides: {},
  doseGrams: 18,
  grinderSetting: 4.5,
  ...over,
});

describe('stepToGatewayState', () => {
  it('maps each step type to the right machine state', () => {
    expect(stepToGatewayState('brew')).toBe('espresso');
    expect(stepToGatewayState('steam')).toBe('steam');
    expect(stepToGatewayState('water')).toBe('hotWater');
    expect(stepToGatewayState('flush')).toBe('flush');
  });
});

describe('RecipeBrewScreen', () => {
  describe('mounting', () => {
    it('renders header with recipe and beverage names', async () => {
      renderScreen({ beverages: [cappuccino()], recipes: [sampleRecipe()] });
      await waitFor(() =>
        expect(screen.getByTestId('brew-beverage-name')).toHaveTextContent(
          'Cappuccino',
        ),
      );
      expect(screen.getByTestId('brew-recipe-name')).toHaveTextContent(
        "Wife's",
      );
    });

    it('renders not-found state for a missing recipe', async () => {
      renderScreen({
        beverages: [],
        recipes: [],
        recipeId: 'missing',
      });
      await waitFor(() => screen.getByRole('alert'));
      expect(screen.getByRole('alert')).toHaveTextContent(/not found/i);
    });
  });

  describe('step bar', () => {
    it('marks step 1 current, the rest as future', async () => {
      renderScreen({ beverages: [cappuccino()], recipes: [sampleRecipe()] });
      await waitFor(() => screen.getByTestId('step-bar'));
      expect(screen.getByTestId('step-bar-item-0')).toHaveAttribute(
        'data-variant',
        'current',
      );
      expect(screen.getByTestId('step-bar-item-1')).toHaveAttribute(
        'data-variant',
        'future',
      );
      expect(screen.getByTestId('step-bar-item-2')).toHaveAttribute(
        'data-variant',
        'future',
      );
    });

    it('the current step button is not clickable but future ones are', async () => {
      renderScreen({ beverages: [cappuccino()], recipes: [sampleRecipe()] });
      await waitFor(() => screen.getByTestId('step-bar'));
      expect(screen.getByTestId('step-bar-button-0')).toBeDisabled();
      expect(screen.getByTestId('step-bar-button-1')).not.toBeDisabled();
      expect(screen.getByTestId('step-bar-button-2')).not.toBeDisabled();
    });
  });

  describe('prep card per step type', () => {
    it('seeds the editable dose/grinder inputs from the Recipe; profile shows the Choose prompt when none is pinned', async () => {
      renderScreen({
        beverages: [cappuccino()],
        recipes: [sampleRecipe({ profileId: undefined })],
      });
      await waitFor(() => screen.getByTestId('prep-card'));
      expect(
        (screen.getByTestId('prep-card-dose-input') as HTMLInputElement).value,
      ).toBe('18');
      expect(
        (screen.getByTestId('prep-card-grinder-input') as HTMLInputElement)
          .value,
      ).toBe('4.5');
      expect(
        screen.getByTestId('prep-card-profile-empty'),
      ).toBeInTheDocument();
    });

    it('target yield + volume inputs are empty when the Recipe doesn’t set them', async () => {
      renderScreen({
        beverages: [cappuccino()],
        recipes: [sampleRecipe()],
      });
      await waitFor(() => screen.getByTestId('prep-card'));
      expect(
        (screen.getByTestId('prep-card-target-yield-input') as HTMLInputElement)
          .value,
      ).toBe('');
      expect(
        (
          screen.getByTestId(
            'prep-card-target-volume-input',
          ) as HTMLInputElement
        ).value,
      ).toBe('');
    });

    it('seeds target yield + volume inputs from the Recipe when present', async () => {
      renderScreen({
        beverages: [cappuccino()],
        recipes: [
          sampleRecipe({ targetYieldGrams: 36, targetVolumeMl: 40 }),
        ],
      });
      await waitFor(() => screen.getByTestId('prep-card'));
      expect(
        (screen.getByTestId('prep-card-target-yield-input') as HTMLInputElement)
          .value,
      ).toBe('36');
      expect(
        (
          screen.getByTestId(
            'prep-card-target-volume-input',
          ) as HTMLInputElement
        ).value,
      ).toBe('40');
    });

    it('editing a prep-card field overrides for this shot only — the saved Recipe is untouched', async () => {
      const { repos } = renderScreen({
        beverages: [cappuccino()],
        recipes: [sampleRecipe({ doseGrams: 18 })],
      });
      const dose = (await waitFor(() =>
        screen.getByTestId('prep-card-dose-input'),
      )) as HTMLInputElement;
      dose.value = '20';
      fireEvent.input(dose);
      fireEvent.blur(dose);
      // The input reflects the override...
      expect(dose.value).toBe('20');
      // ...but the persisted Recipe is unchanged.
      const r = await repos.recipes.get('rec-1');
      expect(r?.doseGrams).toBe(18);
    });

    it('shows the resolved profile title + chart when a Recipe has a profileId', async () => {
      const profile = mkProfileRecord({
        id: 'profile:c-plus',
        profile: {
          title: 'Best Practice C+',
          author: 'Decent',
          tank_temperature: 93,
          steps: [{ name: 'pour', pump: 'pressure', seconds: 20, pressure: 9 }],
        },
        isDefault: true,
      });
      renderScreen({
        beverages: [cappuccino()],
        recipes: [sampleRecipe({ profileId: profile.id })],
        loadProfileById: () => Promise.resolve(profile),
      });
      const title = await waitFor(() =>
        screen.getByTestId('prep-card-profile-title'),
      );
      expect(title).toHaveTextContent('Best Practice C+');
      expect(
        screen.getByTestId('prep-card-profile-default-badge'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('prep-card-profile-meta')).toHaveTextContent(
        'by Decent',
      );
      expect(screen.getByTestId('prep-card-profile-meta')).toHaveTextContent(
        'Tank 93.0 °C',
      );
      expect(
        screen.getByTestId('prep-card-profile-chart'),
      ).toBeInTheDocument();
    });

    it('falls back to "(missing profile — id)" when the loader returns null', async () => {
      renderScreen({
        beverages: [cappuccino()],
        recipes: [sampleRecipe({ profileId: 'profile:ghost' })],
        loadProfileById: () => Promise.resolve(null),
      });
      const missing = await waitFor(() =>
        screen.getByTestId('prep-card-profile-missing'),
      );
      expect(missing).toHaveTextContent('missing profile — profile:ghost');
    });

    it('Change-profile dialog overrides the shot profile without touching the Recipe', async () => {
      const original = mkProfileRecord({
        id: 'profile:orig',
        profile: { title: 'Original' },
      });
      const swapped = mkProfileRecord({
        id: 'profile:swap',
        profile: { title: 'Swapped In' },
      });
      // loadProfileById serves whichever id the draft currently holds;
      // loadProfiles backs the picker dialog list.
      const byId: Record<string, ProfileRecord> = {
        'profile:orig': original,
        'profile:swap': swapped,
      };
      const { repos } = renderScreen({
        beverages: [cappuccino()],
        recipes: [sampleRecipe({ profileId: 'profile:orig' })],
        loadProfileById: (id) => Promise.resolve(byId[id] ?? null),
        loadProfiles: () => Promise.resolve([original, swapped]),
      });
      await waitFor(() =>
        expect(screen.getByTestId('prep-card-profile-title')).toHaveTextContent(
          'Original',
        ),
      );
      // Open the picker, choose the other profile.
      fireEvent.click(screen.getByTestId('prep-card-profile-change'));
      const row = await waitFor(() =>
        screen.getByTestId('profile-row-profile:swap-button'),
      );
      fireEvent.click(row);
      fireEvent.click(screen.getByTestId('profile-picker-choose'));

      // Prep card repaints to the swapped profile...
      await waitFor(() =>
        expect(screen.getByTestId('prep-card-profile-title')).toHaveTextContent(
          'Swapped In',
        ),
      );
      // ...and the saved Recipe still points at the original.
      const r = await repos.recipes.get('rec-1');
      expect(r?.profileId).toBe('profile:orig');
    });
  });

  describe('workflow push (gateway binding)', () => {
    const profileWithSteps = mkProfileRecord({
      id: 'profile:p1',
      profile: {
        title: 'Pushed Profile',
        target_volume: 50,
        steps: [{ name: 'pour', pump: 'pressure', seconds: 20, pressure: 9 }],
      },
    });

    it('pushes profile + context to the gateway once the profile resolves', async () => {
      const { onApplyWorkflow } = renderScreen({
        beverages: [cappuccino()],
        recipes: [
          sampleRecipe({
            name: 'Wife’s',
            profileId: profileWithSteps.id,
            doseGrams: 18,
            grinderSetting: 4.5,
            targetYieldGrams: 36,
          }),
        ],
        loadProfileById: () => Promise.resolve(profileWithSteps),
      });
      await waitFor(() => expect(onApplyWorkflow).toHaveBeenCalled());
      const body = onApplyWorkflow.mock.calls.at(-1)![0];
      expect(body.name).toBe('Wife’s');
      expect(body.profile?.title).toBe('Pushed Profile');
      expect(body.context).toEqual({
        targetDoseWeight: 18,
        targetYield: 36,
        grinderSetting: '4.5', // gateway wants a string
      });
    });

    it('overrides the pushed profile target_volume from the draft', async () => {
      const { onApplyWorkflow } = renderScreen({
        beverages: [cappuccino()],
        recipes: [
          sampleRecipe({
            profileId: profileWithSteps.id,
            targetVolumeMl: 42,
          }),
        ],
        loadProfileById: () => Promise.resolve(profileWithSteps),
      });
      await waitFor(() => expect(onApplyWorkflow).toHaveBeenCalled());
      const body = onApplyWorkflow.mock.calls.at(-1)![0];
      // Profile's own target_volume (50) replaced by the draft override (42).
      expect(body.profile?.target_volume).toBe(42);
    });

    it('sends the profile target_volume unchanged when the draft has no override', async () => {
      const { onApplyWorkflow } = renderScreen({
        beverages: [cappuccino()],
        recipes: [sampleRecipe({ profileId: profileWithSteps.id })],
        loadProfileById: () => Promise.resolve(profileWithSteps),
      });
      await waitFor(() => expect(onApplyWorkflow).toHaveBeenCalled());
      const body = onApplyWorkflow.mock.calls.at(-1)![0];
      expect(body.profile?.target_volume).toBe(50);
    });

    it('does NOT push when the recipe has no profile', async () => {
      const { onApplyWorkflow } = renderScreen({
        beverages: [cappuccino()],
        recipes: [sampleRecipe({ profileId: undefined })],
      });
      // Give the screen a beat to settle (resource + effects).
      await waitFor(() => screen.getByTestId('prep-card'));
      await Promise.resolve();
      expect(onApplyWorkflow).not.toHaveBeenCalled();
    });

    it('re-pushes after an in-prep edit, syncing the new value (Recipe untouched)', async () => {
      const { onApplyWorkflow, repos } = renderScreen({
        beverages: [cappuccino()],
        recipes: [
          sampleRecipe({ profileId: profileWithSteps.id, doseGrams: 18 }),
        ],
        loadProfileById: () => Promise.resolve(profileWithSteps),
      });
      await waitFor(() => expect(onApplyWorkflow).toHaveBeenCalled());
      const dose = screen.getByTestId('prep-card-dose-input') as HTMLInputElement;
      dose.value = '20';
      fireEvent.input(dose);
      fireEvent.blur(dose);
      await waitFor(() => {
        const body = onApplyWorkflow.mock.calls.at(-1)![0];
        expect(body.context?.targetDoseWeight).toBe(20);
      });
      // Saved Recipe still has the original dose.
      const r = await repos.recipes.get('rec-1');
      expect(r?.doseGrams).toBe(18);
    });
  });

  describe('non-brew prep', () => {
    it('steam prep has no Beverage-level parameters today', async () => {
      // No SteamConfig fields ship at the Beverage layer (purge is firmware-
      // driven, not Recipe-level). The prep card falls through to the
      // generic "no prep needed" copy, like water and flush.
      renderScreen({
        beverages: [
          {
            id: 'bev-cap',
            name: 'Cappuccino',
            steps: [beverageStep('steam', {}, 'step-steam')],
          },
        ],
        recipes: [sampleRecipe()],
      });
      const card = await waitFor(() => screen.getByTestId('prep-card'));
      expect(card).toHaveTextContent(/No prep needed/i);
    });

    it('shows a "no prep needed" caption for water and flush', async () => {
      renderScreen({
        beverages: [
          {
            id: 'bev-cap',
            name: 'Cappuccino',
            steps: [beverageStep('flush', {}, 'step-flush')],
          },
        ],
        recipes: [sampleRecipe()],
      });
      const card = await waitFor(() => screen.getByTestId('prep-card'));
      expect(card).toHaveTextContent(/no prep needed/i);
    });
  });

  describe('state machine — single step', () => {
    it('Start fires requestState with the matching gateway state', async () => {
      const env = renderScreen({
        beverages: [
          {
            id: 'bev-cap',
            name: 'Cappuccino',
            steps: [beverageStep('brew', {}, 'step-brew')],
          },
        ],
        recipes: [sampleRecipe()],
      });
      fireEvent.click(await waitFor(() => screen.getByTestId('prep-card-start')));
      await waitFor(() => expect(env.requestState).toHaveBeenCalledWith('espresso'));
    });

    it('prep card shows "in progress" once Start is tapped', async () => {
      renderScreen({
        beverages: [
          {
            id: 'bev-cap',
            name: 'Cappuccino',
            steps: [beverageStep('brew', {}, 'step-brew')],
          },
        ],
        recipes: [sampleRecipe()],
      });
      fireEvent.click(await waitFor(() => screen.getByTestId('prep-card-start')));
      await waitFor(() =>
        expect(screen.getByTestId('prep-card-running')).toBeInTheDocument(),
      );
      expect(screen.queryByTestId('prep-card-start')).not.toBeInTheDocument();
    });

    it('advances to done when the gateway enters then leaves the target state', async () => {
      const env = renderScreen({
        beverages: [
          {
            id: 'bev-cap',
            name: 'Cappuccino',
            steps: [
              beverageStep('brew', {}, 'step-brew'),
              beverageStep('steam', {}, 'step-steam'),
            ],
          },
        ],
        recipes: [sampleRecipe()],
      });
      fireEvent.click(await waitFor(() => screen.getByTestId('prep-card-start')));

      // Gateway enters 'espresso'.
      env.setMachineSnap(snapshotWithState('espresso'));
      await waitFor(() =>
        expect(screen.getByTestId('step-bar-item-0')).toHaveAttribute(
          'data-variant',
          'current',
        ),
      );
      // Then leaves it → step done, screen pivots to step 2 (steam).
      env.setMachineSnap(snapshotWithState('idle'));
      await waitFor(() =>
        expect(screen.getByTestId('step-bar-item-0')).toHaveAttribute(
          'data-variant',
          'done',
        ),
      );
      // Step 2 (steam) is now current — prep card switched.
      expect(screen.getByTestId('step-bar-item-1')).toHaveAttribute(
        'data-variant',
        'current',
      );
      // Heading text now lives in two adjacent elements ("Prep for" / "Steam")
      // so concatenated textContent collapses the whitespace — match flexibly.
      expect(screen.getByTestId('prep-card')).toHaveTextContent(
        /prep\s*for\s*steam/i,
      );
    });
  });

  describe('skipping', () => {
    it('clicking a future step jumps past intermediate ones and marks them skipped', async () => {
      renderScreen({ beverages: [cappuccino()], recipes: [sampleRecipe()] });
      await waitFor(() => screen.getByTestId('step-bar'));

      // Click step 3 (index 2 / steam) directly from idle. Skips step 1 (brew)
      // and step 2 (flush).
      fireEvent.click(screen.getByTestId('step-bar-button-2'));

      await waitFor(() =>
        expect(screen.getByTestId('step-bar-item-2')).toHaveAttribute(
          'data-variant',
          'current',
        ),
      );
      expect(screen.getByTestId('step-bar-item-0')).toHaveAttribute(
        'data-variant',
        'skipped',
      );
      expect(screen.getByTestId('step-bar-item-1')).toHaveAttribute(
        'data-variant',
        'skipped',
      );
    });
  });

  describe('post-brew', () => {
    it('shows the post-brew view after the last step ends', async () => {
      const env = renderScreen({
        beverages: [
          {
            id: 'bev-cap',
            name: 'Cappuccino',
            steps: [beverageStep('brew', {}, 'step-brew')],
          },
        ],
        recipes: [sampleRecipe()],
      });
      fireEvent.click(await waitFor(() => screen.getByTestId('prep-card-start')));
      env.setMachineSnap(snapshotWithState('espresso'));
      env.setMachineSnap(snapshotWithState('idle'));

      await waitFor(() => screen.getByTestId('post-brew-view'));
      expect(screen.queryByTestId('prep-card')).not.toBeInTheDocument();
    });

    it('Brew again resets to step 1', async () => {
      const env = renderScreen({
        beverages: [
          {
            id: 'bev-cap',
            name: 'Cappuccino',
            steps: [beverageStep('brew', {}, 'step-brew')],
          },
        ],
        recipes: [sampleRecipe()],
      });
      fireEvent.click(await waitFor(() => screen.getByTestId('prep-card-start')));
      env.setMachineSnap(snapshotWithState('espresso'));
      env.setMachineSnap(snapshotWithState('idle'));
      await waitFor(() => screen.getByTestId('post-brew-view'));

      fireEvent.click(screen.getByTestId('post-brew-brew-again'));
      await waitFor(() => screen.getByTestId('prep-card'));
      expect(screen.getByTestId('step-bar-item-0')).toHaveAttribute(
        'data-variant',
        'current',
      );
    });

    it('Done calls onExit', async () => {
      const env = renderScreen({
        beverages: [
          {
            id: 'bev-cap',
            name: 'Cappuccino',
            steps: [beverageStep('brew', {}, 'step-brew')],
          },
        ],
        recipes: [sampleRecipe()],
      });
      fireEvent.click(await waitFor(() => screen.getByTestId('prep-card-start')));
      env.setMachineSnap(snapshotWithState('espresso'));
      env.setMachineSnap(snapshotWithState('idle'));
      await waitFor(() => screen.getByTestId('post-brew-view'));

      fireEvent.click(screen.getByTestId('post-brew-done'));
      expect(env.onExit).toHaveBeenCalledOnce();
    });
  });

  describe('back arrow', () => {
    it('clicking back calls onExit', async () => {
      const env = renderScreen({
        beverages: [cappuccino()],
        recipes: [sampleRecipe()],
      });
      fireEvent.click(await waitFor(() => screen.getByTestId('brew-back-button')));
      expect(env.onExit).toHaveBeenCalledOnce();
    });
  });
});
