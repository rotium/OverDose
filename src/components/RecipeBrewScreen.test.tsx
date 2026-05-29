import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { RecipeBrewScreen, stepToGatewayState, type BrewBundle } from './RecipeBrewScreen';
import { WithRepositories } from '../test/repositories';
import {
  LocalRoutineRepository,
  LocalRecipeRepository,
} from '../repositories';
import { MemoryStorage } from '../test/memoryStorage';
import { routineStep } from '../domain';
import type { Routine, Recipe } from '../domain';
import type {
  MachineSnapshot,
  MachineState,
  ShotSettingsSnapshot,
} from '../snapshot';
import type { Pitcher } from '../domain';
import type {
  GatewayShotMeasurement,
  GatewayShotRecord,
  GatewayShotSummary,
  ProfileRecord,
  ShotAnnotationsPatch,
} from '../api';
import type { WsStream } from '../streams';

interface SeedOpts {
  routines: Routine[];
  recipes: Recipe[];
}

const seedRepos = ({ routines, recipes }: SeedOpts) => {
  const bStore = new MemoryStorage();
  bStore.setItem('starter-skin.routines.v1', JSON.stringify(routines));
  bStore.setItem('starter-skin.routines.seeded.v1', '1');
  const rStore = new MemoryStorage();
  rStore.setItem('starter-skin.recipes.v1', JSON.stringify(recipes));
  rStore.setItem('starter-skin.recipes.seeded.v1', '1');
  return {
    routines: new LocalRoutineRepository(bStore),
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
    optimisticShot?: GatewayShotRecord | null;
    fetchLatestShot?: () => Promise<GatewayShotSummary>;
    fetchShot?: (id: string) => Promise<GatewayShotRecord>;
    updateShot?: (id: string, patch: ShotAnnotationsPatch) => Promise<void>;
    saveDebounceMs?: number;
    bundleOverride?: BrewBundle;
    isWaterCritical?: () => boolean;
    /** Seed snapshot for the shotSettings stream (the base the steam-step
     *  start overlays its temp/duration onto). Omit to leave the stream empty. */
    shotSettingsSnap?: ShotSettingsSnapshot | null;
    updateShotSettings?: (s: ShotSettingsSnapshot) => Promise<void>;
    updateMachineSettings?: (partial: { steamFlow: number }) => Promise<void>;
    /** Steam-flow seed source; defaults to null (slider falls back to 0.8). */
    loadMachineSettings?: () => Promise<{ steamFlow: number } | null>;
    /** Pitcher list for the steam step's picker. Omit to use the seeded repo. */
    loadPitchers?: () => Promise<Pitcher[]>;
    /** Whether the steam-flow slider shows in steam prep. Default false. */
    showFlowSlider?: () => boolean;
  },
): ReturnType<typeof mkSetup> & {
  onApplyWorkflow: ReturnType<typeof vi.fn>;
  updateShot: ReturnType<typeof vi.fn>;
  updateShotSettings: ReturnType<typeof vi.fn>;
  updateMachineSettings: ReturnType<typeof vi.fn>;
} => {
  const env = mkSetup({ routines: opts.routines, recipes: opts.recipes });
  // Default profile fetchers return empty/null so the brew-step prep card
  // never hits the real api in tests; callers that need a profile-loaded
  // assertion pass their own.
  const loadProfileById =
    opts.loadProfileById ?? (() => Promise.resolve<ProfileRecord | null>(null));
  const loadProfiles =
    opts.loadProfiles ?? (() => Promise.resolve<ProfileRecord[]>([]));
  const onApplyWorkflow = vi.fn(async () => {});
  // Post-brew shot fetchers default to a rejection so the summary resolves
  // to null (post-brew shows empty/optimistic). Callers exercising the
  // result screen pass their own.
  const fetchLatestShot =
    opts.fetchLatestShot ?? (() => Promise.reject(new Error('no shot')));
  const fetchShot =
    opts.fetchShot ?? (() => Promise.reject(new Error('no shot')));
  const optimisticShot = () => opts.optimisticShot ?? null;
  const updateShot = vi.fn(
    opts.updateShot ?? (async (_id: string, _patch: ShotAnnotationsPatch) => {}),
  );
  const updateShotSettings = vi.fn(
    opts.updateShotSettings ?? (async (_s: ShotSettingsSnapshot) => {}),
  );
  const updateMachineSettings = vi.fn(
    opts.updateMachineSettings ?? (async (_p: { steamFlow: number }) => {}),
  );
  const [shotSettings] = createSignal<ShotSettingsSnapshot | null>(
    opts.shotSettingsSnap ?? null,
  );
  const shotSettingsStream: WsStream<ShotSettingsSnapshot> = {
    latest: shotSettings,
    status: createSignal<'open'>('open')[0],
  };
  render(() => (
    <WithRepositories routines={env.repos.routines} recipes={env.repos.recipes}>
      <RecipeBrewScreen
        recipeId={opts.recipeId ?? 'rec-1'}
        bundleOverride={opts.bundleOverride}
        onExit={env.onExit}
        machineStream={() => env.machineStream}
        isWaterCritical={opts.isWaterCritical}
        requestState={env.requestState}
        shotSettingsStream={() => shotSettingsStream}
        updateShotSettings={updateShotSettings}
        updateMachineSettings={updateMachineSettings}
        loadMachineSettings={
          opts.loadMachineSettings ?? (() => Promise.resolve(null))
        }
        loadPitchers={opts.loadPitchers}
        showFlowSlider={opts.showFlowSlider}
        loadProfileById={loadProfileById}
        loadProfiles={loadProfiles}
        onApplyWorkflow={onApplyWorkflow}
        fetchLatestShot={fetchLatestShot}
        fetchShot={fetchShot}
        optimisticShot={optimisticShot}
        updateShot={updateShot}
        saveDebounceMs={opts.saveDebounceMs ?? 0}
      />
    </WithRepositories>
  ));
  return {
    ...env,
    onApplyWorkflow,
    updateShot,
    updateShotSettings,
    updateMachineSettings,
  };
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

const cappuccino = (): Routine => ({
  id: 'bev-cap',
  name: 'Cappuccino',
  steps: [
    routineStep('brew', {}, 'step-brew'),
    routineStep('flush', {}, 'step-flush'),
    routineStep('steam', {}, 'step-steam'),
  ],
});

const sampleRecipe = (over: Partial<Recipe> = {}): Recipe => ({
  id: 'rec-1',
  name: "Wife's",
  routineId: 'bev-cap',
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
    it('uses bundleOverride (ad-hoc Explore brew) without a seeded recipe', async () => {
      // Repos are empty — the screen must run entirely off the injected
      // bundle, which is how the Explore "Brew" tile drives an ad-hoc brew.
      renderScreen({
        routines: [],
        recipes: [],
        bundleOverride: {
          recipe: {
            id: 'explore-brew',
            name: 'Espresso',
            routineId: 'explore-brew-routine',
            doseGrams: 18,
            targetYieldGrams: 36,
            overrides: {},
          },
          routine: {
            id: 'explore-brew-routine',
            name: 'Brew',
            steps: [routineStep('brew', {}, 'explore-brew-step')],
          },
        },
      });
      // Prep renders (the brew step), seeded from the override's dose.
      const dose = await waitFor(() => screen.getByTestId('prep-card-dose-input'));
      expect(dose).toHaveValue(18);
      expect(screen.getByTestId('prep-card-start')).toBeInTheDocument();
    });

    it('renders header with recipe and routine names', async () => {
      renderScreen({ routines: [cappuccino()], recipes: [sampleRecipe()] });
      await waitFor(() =>
        expect(screen.getByTestId('brew-routine-name')).toHaveTextContent(
          'Cappuccino',
        ),
      );
      expect(screen.getByTestId('brew-recipe-name')).toHaveTextContent(
        "Wife's",
      );
    });

    it('renders not-found state for a missing recipe', async () => {
      renderScreen({
        routines: [],
        recipes: [],
        recipeId: 'missing',
      });
      await waitFor(() => screen.getByRole('alert'));
      expect(screen.getByRole('alert')).toHaveTextContent(/not found/i);
    });
  });

  describe('step bar', () => {
    it('marks step 1 current, the rest as future', async () => {
      renderScreen({ routines: [cappuccino()], recipes: [sampleRecipe()] });
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
      renderScreen({ routines: [cappuccino()], recipes: [sampleRecipe()] });
      await waitFor(() => screen.getByTestId('step-bar'));
      expect(screen.getByTestId('step-bar-button-0')).toBeDisabled();
      expect(screen.getByTestId('step-bar-button-1')).not.toBeDisabled();
      expect(screen.getByTestId('step-bar-button-2')).not.toBeDisabled();
    });
  });

  describe('warming up', () => {
    // The DE1 emits state=idle + substate=preparingForShot while the boiler
    // climbs to target. Both the Start button and the current step bar item
    // should flag that the machine isn't ready, so the user doesn't pull a
    // cold shot.
    const warmingSnap: MachineSnapshot = {
      ...snapshotWithState('idle'),
      state: { state: 'idle', substate: 'preparingForShot' },
    };
    const readySnap: MachineSnapshot = snapshotWithState('idle');

    it('disables the Start button and shows the warming label', async () => {
      const env = renderScreen({
        routines: [cappuccino()],
        recipes: [sampleRecipe()],
      });
      env.setMachineSnap(warmingSnap);
      const start = await waitFor(() => screen.getByTestId('prep-card-start'));
      expect(start).toBeDisabled();
      expect(start).toHaveAttribute('data-warming', 'true');
      expect(start).toHaveTextContent(/warming up/i);
    });

    it('marks only the current step bar item with data-warming', async () => {
      const env = renderScreen({
        routines: [cappuccino()],
        recipes: [sampleRecipe()],
      });
      env.setMachineSnap(warmingSnap);
      await waitFor(() => screen.getByTestId('step-bar'));
      expect(screen.getByTestId('step-bar-item-0')).toHaveAttribute(
        'data-warming',
        'true',
      );
      expect(screen.getByTestId('step-bar-item-1')).not.toHaveAttribute(
        'data-warming',
      );
    });

    it('clears the warming state once the machine becomes ready', async () => {
      const env = renderScreen({
        routines: [cappuccino()],
        recipes: [sampleRecipe()],
      });
      env.setMachineSnap(warmingSnap);
      const start = await waitFor(() => screen.getByTestId('prep-card-start'));
      expect(start).toBeDisabled();

      env.setMachineSnap(readySnap);
      await waitFor(() =>
        expect(screen.getByTestId('prep-card-start')).not.toBeDisabled(),
      );
      expect(screen.getByTestId('prep-card-start')).not.toHaveAttribute(
        'data-warming',
      );
      expect(screen.getByTestId('step-bar-item-0')).not.toHaveAttribute(
        'data-warming',
      );
    });
  });

  describe('heater off (front switch off)', () => {
    // Substate=errorNoAC while state stays idle is the DE1's only
    // explicit signal that the front physical switch cut AC to the
    // brew heater.
    const heaterOffSnap: MachineSnapshot = {
      ...snapshotWithState('idle'),
      state: { state: 'idle', substate: 'errorNoAC' },
    };
    const readySnap: MachineSnapshot = snapshotWithState('idle');

    it('disables Start and shows the heater-off label with PowerIcon', async () => {
      const env = renderScreen({
        routines: [cappuccino()],
        recipes: [sampleRecipe()],
      });
      env.setMachineSnap(heaterOffSnap);
      const start = await waitFor(() => screen.getByTestId('prep-card-start'));
      expect(start).toBeDisabled();
      expect(start).toHaveAttribute('data-heater-off', 'true');
      expect(start).toHaveTextContent(/heater off/i);
    });

    it('marks only the current step bar item with data-heater-off', async () => {
      const env = renderScreen({
        routines: [cappuccino()],
        recipes: [sampleRecipe()],
      });
      env.setMachineSnap(heaterOffSnap);
      await waitFor(() => screen.getByTestId('step-bar'));
      expect(screen.getByTestId('step-bar-item-0')).toHaveAttribute(
        'data-heater-off',
        'true',
      );
      expect(screen.getByTestId('step-bar-item-1')).not.toHaveAttribute(
        'data-heater-off',
      );
    });

    it('clears heater-off when the switch is flipped back on', async () => {
      const env = renderScreen({
        routines: [cappuccino()],
        recipes: [sampleRecipe()],
      });
      env.setMachineSnap(heaterOffSnap);
      await waitFor(() =>
        expect(screen.getByTestId('prep-card-start')).toBeDisabled(),
      );
      env.setMachineSnap(readySnap);
      await waitFor(() =>
        expect(screen.getByTestId('prep-card-start')).not.toBeDisabled(),
      );
      expect(screen.getByTestId('prep-card-start')).not.toHaveAttribute(
        'data-heater-off',
      );
    });
  });

  describe('water critical', () => {
    // Driven by an isWaterCritical accessor — App.tsx computes the value
    // from the water-levels stream + user prefs. The brew screen just
    // gates the action on whatever the parent passes.
    it('disables Start with the droplet icon + "Refill water" label', async () => {
      const env = renderScreen({
        routines: [cappuccino()],
        recipes: [sampleRecipe()],
        isWaterCritical: () => true,
      });
      env.setMachineSnap(snapshotWithState('idle'));
      const start = await waitFor(() => screen.getByTestId('prep-card-start'));
      expect(start).toBeDisabled();
      expect(start).toHaveAttribute('data-water-critical', 'true');
      expect(start).toHaveTextContent(/refill water/i);
    });

    it('marks only the current step bar item with data-water-critical', async () => {
      const env = renderScreen({
        routines: [cappuccino()],
        recipes: [sampleRecipe()],
        isWaterCritical: () => true,
      });
      env.setMachineSnap(snapshotWithState('idle'));
      await waitFor(() => screen.getByTestId('step-bar'));
      expect(screen.getByTestId('step-bar-item-0')).toHaveAttribute(
        'data-water-critical',
        'true',
      );
      expect(screen.getByTestId('step-bar-item-1')).not.toHaveAttribute(
        'data-water-critical',
      );
    });

    it('heater-off wins priority over water-critical on the Start button', async () => {
      // Substates are mutually exclusive on the firmware side, but we
      // make the visual priority explicit anyway: power glyph + "Heater
      // off" label when both signals fire simultaneously.
      const heaterOffSnap: MachineSnapshot = {
        ...snapshotWithState('idle'),
        state: { state: 'idle', substate: 'errorNoAC' },
      };
      const env = renderScreen({
        routines: [cappuccino()],
        recipes: [sampleRecipe()],
        isWaterCritical: () => true,
      });
      env.setMachineSnap(heaterOffSnap);
      const start = await waitFor(() => screen.getByTestId('prep-card-start'));
      expect(start).toHaveAttribute('data-heater-off', 'true');
      expect(start).not.toHaveAttribute('data-water-critical');
      expect(start).toHaveTextContent(/heater off/i);
    });
  });

  describe('prep card per step type', () => {
    it('seeds the editable dose/grinder inputs from the Recipe; profile shows the Choose prompt when none is pinned', async () => {
      renderScreen({
        routines: [cappuccino()],
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
        routines: [cappuccino()],
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
        routines: [cappuccino()],
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
        routines: [cappuccino()],
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
        routines: [cappuccino()],
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
        routines: [cappuccino()],
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
        routines: [cappuccino()],
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
        routines: [cappuccino()],
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
        routines: [cappuccino()],
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
        routines: [cappuccino()],
        recipes: [sampleRecipe({ profileId: profileWithSteps.id })],
        loadProfileById: () => Promise.resolve(profileWithSteps),
      });
      await waitFor(() => expect(onApplyWorkflow).toHaveBeenCalled());
      const body = onApplyWorkflow.mock.calls.at(-1)![0];
      expect(body.profile?.target_volume).toBe(50);
    });

    it('does NOT push when the recipe has no profile', async () => {
      const { onApplyWorkflow } = renderScreen({
        routines: [cappuccino()],
        recipes: [sampleRecipe({ profileId: undefined })],
      });
      // Give the screen a beat to settle (resource + effects).
      await waitFor(() => screen.getByTestId('prep-card'));
      await Promise.resolve();
      expect(onApplyWorkflow).not.toHaveBeenCalled();
    });

    it('re-pushes after an in-prep edit, syncing the new value (Recipe untouched)', async () => {
      const { onApplyWorkflow, repos } = renderScreen({
        routines: [cappuccino()],
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
    const baseShot: ShotSettingsSnapshot = {
      steamSetting: 0,
      targetSteamTemp: 150,
      targetSteamDuration: 99,
      targetHotWaterTemp: 85,
      targetHotWaterVolume: 100,
      targetHotWaterDuration: 35,
      targetShotVolume: 36,
      groupTemp: 94,
    };

    const PITCHERS: Pitcher[] = [
      {
        id: 'p-small',
        name: 'Small',
        capacityMl: 350,
        steamDurationSec: 30,
        steamTempC: 150,
        steamFlow: 0.8,
      },
      {
        id: 'p-large',
        name: 'Large',
        capacityMl: 600,
        steamDurationSec: 50,
        steamTempC: 160,
        steamFlow: 1.2,
      },
    ];

    const steamRoutine = () => ({
      id: 'bev-cap',
      name: 'Cappuccino',
      steps: [routineStep('steam', {}, 'step-steam')],
    });

    const sliderValue = (testId: string): string =>
      (screen.getByTestId(testId) as HTMLInputElement).value;

    it('defaults to the recipe\'s pitcher and seeds the duration slider', async () => {
      renderScreen({
        routines: [steamRoutine()],
        recipes: [sampleRecipe({ pitcherId: 'p-large' })],
        loadPitchers: () => Promise.resolve(PITCHERS),
      });
      await waitFor(() => screen.getByTestId('steam-param-duration'));
      // The recipe's pitcher chip is selected; both chips are offered.
      expect(screen.getByTestId('pitcher-p-small')).toBeInTheDocument();
      expect(screen.getByTestId('pitcher-p-large')).toHaveAttribute(
        'data-selected',
        'true',
      );
      // Duration reflects the large pitcher; there is no temperature slider.
      expect(sliderValue('steam-param-duration')).toBe('50');
      expect(screen.queryByTestId('steam-param-temp')).not.toBeInTheDocument();
    });

    it('hides the flow slider unless the pref is on', async () => {
      renderScreen({
        routines: [steamRoutine()],
        recipes: [sampleRecipe({ pitcherId: 'p-large' })],
        loadPitchers: () => Promise.resolve(PITCHERS),
      });
      await waitFor(() => screen.getByTestId('steam-param-duration'));
      expect(screen.queryByTestId('steam-param-flow')).not.toBeInTheDocument();
    });

    it('shows the flow slider when the pref is on', async () => {
      renderScreen({
        routines: [steamRoutine()],
        recipes: [sampleRecipe({ pitcherId: 'p-large' })],
        loadPitchers: () => Promise.resolve(PITCHERS),
        showFlowSlider: () => true,
      });
      await waitFor(() => screen.getByTestId('steam-param-flow'));
      expect(sliderValue('steam-param-flow')).toBe('1.2');
    });

    it('seeds the duration slider from the machine when no pitcher is named', async () => {
      renderScreen({
        routines: [steamRoutine()],
        recipes: [sampleRecipe()],
        shotSettingsSnap: baseShot, // duration 99 / temp 150
        loadMachineSettings: () => Promise.resolve({ steamFlow: 0.6 }),
        loadPitchers: () => Promise.resolve(PITCHERS),
        showFlowSlider: () => true,
      });
      await waitFor(() => screen.getByTestId('steam-param-duration'));
      // No chip selected; sliders show the machine's current settings.
      expect(screen.getByTestId('pitcher-p-small')).not.toHaveAttribute(
        'data-selected',
      );
      expect(sliderValue('steam-param-duration')).toBe('99');
      expect(sliderValue('steam-param-flow')).toBe('0.6');
    });

    it('does not write any steam settings when no pitcher is chosen', async () => {
      const env = renderScreen({
        routines: [steamRoutine()],
        recipes: [sampleRecipe()],
        shotSettingsSnap: baseShot,
        loadPitchers: () => Promise.resolve(PITCHERS),
      });
      await waitFor(() => screen.getByTestId('steam-param-duration'));
      fireEvent.click(screen.getByTestId('prep-card-start'));
      await waitFor(() =>
        expect(env.requestState).toHaveBeenCalledWith('steam'),
      );
      // No pitcher + untouched → machine keeps its current steam settings.
      expect(env.updateShotSettings).not.toHaveBeenCalled();
      expect(env.updateMachineSettings).not.toHaveBeenCalled();
    });

    it('selecting a pitcher loads its values into the sliders', async () => {
      renderScreen({
        routines: [steamRoutine()],
        recipes: [sampleRecipe({ pitcherId: 'p-small' })],
        loadPitchers: () => Promise.resolve(PITCHERS),
      });
      await waitFor(() => screen.getByTestId('steam-param-duration'));
      expect(sliderValue('steam-param-duration')).toBe('30');
      fireEvent.click(screen.getByTestId('pitcher-p-large'));
      expect(screen.getByTestId('pitcher-p-large')).toHaveAttribute(
        'data-selected',
        'true',
      );
      expect(sliderValue('steam-param-duration')).toBe('50');
    });

    it('editing a slider detaches from the pitcher and applies the custom value', async () => {
      const env = renderScreen({
        routines: [steamRoutine()],
        recipes: [sampleRecipe({ pitcherId: 'p-small' })],
        shotSettingsSnap: baseShot,
        loadPitchers: () => Promise.resolve(PITCHERS),
      });
      const dur = (await waitFor(() =>
        screen.getByTestId('steam-param-duration'),
      )) as HTMLInputElement;
      // Recipe seeded small (selected).
      expect(screen.getByTestId('pitcher-p-small')).toHaveAttribute(
        'data-selected',
        'true',
      );
      // Drag the duration slider → pitcher deselects.
      dur.value = '42';
      fireEvent.input(dur);
      fireEvent.pointerUp(dur);
      expect(screen.getByTestId('pitcher-p-small')).not.toHaveAttribute(
        'data-selected',
      );

      fireEvent.click(screen.getByTestId('prep-card-start'));
      await waitFor(() => expect(env.updateShotSettings).toHaveBeenCalled());
      const body = env.updateShotSettings.mock
        .calls[0]![0] as ShotSettingsSnapshot;
      // Custom duration applied; temp stays the small pitcher's seeded value.
      expect(body.targetSteamDuration).toBe(42);
      expect(body.targetSteamTemp).toBe(150);
    });

    it('applies the chosen pitcher\'s params before steaming', async () => {
      const env = renderScreen({
        routines: [steamRoutine()],
        recipes: [sampleRecipe({ pitcherId: 'p-small' })],
        shotSettingsSnap: baseShot,
        loadPitchers: () => Promise.resolve(PITCHERS),
      });
      // Switch from the recipe default (small) to large, then start.
      fireEvent.click(await waitFor(() => screen.getByTestId('pitcher-p-large')));
      fireEvent.click(screen.getByTestId('prep-card-start'));

      await waitFor(() => expect(env.updateShotSettings).toHaveBeenCalled());
      const body = env.updateShotSettings.mock
        .calls[0]![0] as ShotSettingsSnapshot;
      // shotSettings carries temp + duration (overlaid on the live snapshot).
      expect(body.targetSteamDuration).toBe(50);
      expect(body.targetSteamTemp).toBe(160);
      // Flow rides machineSettings, not shotSettings.
      await waitFor(() =>
        expect(env.updateMachineSettings).toHaveBeenCalledWith({
          steamFlow: 1.2,
        }),
      );
      await waitFor(() =>
        expect(env.requestState).toHaveBeenCalledWith('steam'),
      );
    });

    it('shows a "no prep needed" caption for water and flush', async () => {
      renderScreen({
        routines: [
          {
            id: 'bev-cap',
            name: 'Cappuccino',
            steps: [routineStep('flush', {}, 'step-flush')],
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
        routines: [
          {
            id: 'bev-cap',
            name: 'Cappuccino',
            steps: [routineStep('brew', {}, 'step-brew')],
          },
        ],
        recipes: [sampleRecipe()],
      });
      fireEvent.click(await waitFor(() => screen.getByTestId('prep-card-start')));
      await waitFor(() => expect(env.requestState).toHaveBeenCalledWith('espresso'));
    });

    it('prep card shows "in progress" once Start is tapped', async () => {
      renderScreen({
        routines: [
          {
            id: 'bev-cap',
            name: 'Cappuccino',
            steps: [routineStep('brew', {}, 'step-brew')],
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
        routines: [
          {
            id: 'bev-cap',
            name: 'Cappuccino',
            steps: [
              routineStep('brew', {}, 'step-brew'),
              routineStep('steam', {}, 'step-steam'),
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
      renderScreen({ routines: [cappuccino()], recipes: [sampleRecipe()] });
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
        routines: [
          {
            id: 'bev-cap',
            name: 'Cappuccino',
            steps: [routineStep('brew', {}, 'step-brew')],
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
        routines: [
          {
            id: 'bev-cap',
            name: 'Cappuccino',
            steps: [routineStep('brew', {}, 'step-brew')],
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
        routines: [
          {
            id: 'bev-cap',
            name: 'Cappuccino',
            steps: [routineStep('brew', {}, 'step-brew')],
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

    it('shows empty copy when no shot data is available', async () => {
      const env = renderScreen({
        routines: [
          {
            id: 'bev-cap',
            name: 'Cappuccino',
            steps: [routineStep('brew', {}, 'step-brew')],
          },
        ],
        recipes: [sampleRecipe()],
        // no optimisticShot, fetchers reject → null
      });
      fireEvent.click(await waitFor(() => screen.getByTestId('prep-card-start')));
      env.setMachineSnap(snapshotWithState('espresso'));
      env.setMachineSnap(snapshotWithState('idle'));
      await waitFor(() => screen.getByTestId('post-brew-view'));
      await waitFor(() =>
        expect(screen.getByTestId('post-brew-empty')).toBeInTheDocument(),
      );
    });

    it('renders the result summary (headline, stats, targets) from the shot', async () => {
      const mkMeas = (
        tSec: number,
        flow: number,
        pressure: number,
        weight: number,
      ): GatewayShotMeasurement => ({
        machine: {
          timestamp: new Date(
            Date.UTC(2026, 4, 27, 8, 0, tSec),
          ).toISOString(),
          flow,
          pressure,
          mixTemperature: 92,
          groupTemperature: 92,
        },
        scale: { weight },
      });
      const shot: GatewayShotRecord = {
        id: 'shot-xyz',
        timestamp: '2026-05-27T08:00:10.000Z',
        workflow: {
          name: 'Cappuccino',
          profile: { title: 'Best Practice C+', target_volume: 50 },
          context: {
            targetDoseWeight: 18,
            targetYield: 36,
            coffeeName: 'Brazil',
          },
        },
        measurements: [
          mkMeas(0, 0.5, 2, 0),
          mkMeas(1, 2.5, 9.1, 20),
          mkMeas(2, 2.0, 8.0, 35.8),
        ],
      };
      const env = renderScreen({
        routines: [
          {
            id: 'bev-cap',
            name: 'Cappuccino',
            steps: [routineStep('brew', {}, 'step-brew')],
          },
        ],
        recipes: [sampleRecipe()],
        // optimistic record paints immediately; fetchers reject → stays optimistic
        optimisticShot: shot,
      });
      fireEvent.click(await waitFor(() => screen.getByTestId('prep-card-start')));
      env.setMachineSnap(snapshotWithState('espresso'));
      env.setMachineSnap(snapshotWithState('idle'));
      await waitFor(() => screen.getByTestId('post-brew-view'));

      // Review identity: the distinct review surface (stats rail + rating +
      // Visualizer placeholder) is what marks this as the completed shot, not
      // a live-view clone.
      expect(screen.getByTestId('post-brew-stats')).toBeInTheDocument();
      expect(screen.getByTestId('post-brew-rating')).toBeInTheDocument();
      expect(screen.getByTestId('post-brew-visualizer')).toBeInTheDocument();
      const headline = await waitFor(() =>
        screen.getByTestId('post-brew-headline'),
      );
      expect(headline).toHaveTextContent('Best Practice C+');
      expect(screen.getByTestId('post-brew-subtitle')).toHaveTextContent(
        'Cappuccino · Brazil',
      );
      // Dose is now an inline-editable field, seeded from the derived dose.
      expect(screen.getByTestId('post-brew-dose-input')).toHaveValue(18);
      // Yield = measured last scale weight 35.8; target shown separately.
      expect(screen.getByTestId('post-brew-stat-yield')).toHaveTextContent('35.8');
      expect(
        screen.getByTestId('post-brew-stat-yield-target'),
      ).toHaveTextContent('target 36');
      // Time is the header hero now, not a readout cell.
      expect(screen.getByTestId('post-brew-time')).toHaveTextContent('2');
      expect(
        screen.getByTestId('post-brew-stat-peak-pressure'),
      ).toHaveTextContent('9.1 bar');
      expect(
        screen.getByTestId('post-brew-stat-peak-flow'),
      ).toHaveTextContent('2.5 mL/s');
      // Volume = 2.5 + 2.0 = 4.5 → "4 mL" (0 digits). Target 50 mL shown.
      expect(screen.getByTestId('post-brew-stat-volume')).toHaveTextContent(
        'mL',
      );
      expect(
        screen.getByTestId('post-brew-stat-volume-target'),
      ).toHaveTextContent('target 50 mL');
    });

    it('legend toggles trace visibility (aria-pressed flips)', async () => {
      const shot: GatewayShotRecord = {
        id: 'shot-leg',
        timestamp: '2026-05-27T08:00:10.000Z',
        workflow: { name: 'Cappuccino', profile: { title: 'C+' } },
        measurements: [
          {
            machine: {
              timestamp: '2026-05-27T08:00:00.000Z',
              flow: 2,
              pressure: 9,
              mixTemperature: 92,
              groupTemperature: 92,
            },
            scale: { weight: 30 },
          },
          {
            machine: {
              timestamp: '2026-05-27T08:00:02.000Z',
              flow: 2,
              pressure: 9,
              mixTemperature: 92,
              groupTemperature: 92,
            },
            scale: { weight: 36 },
          },
        ],
      };
      const env = renderScreen({
        routines: [
          {
            id: 'bev-cap',
            name: 'Cappuccino',
            steps: [routineStep('brew', {}, 'step-brew')],
          },
        ],
        recipes: [sampleRecipe()],
        optimisticShot: shot,
      });
      fireEvent.click(await waitFor(() => screen.getByTestId('prep-card-start')));
      env.setMachineSnap(snapshotWithState('espresso'));
      env.setMachineSnap(snapshotWithState('idle'));
      const toggle = await waitFor(() =>
        screen.getByTestId('post-brew-legend-pressure'),
      );
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
    });
  });

  describe('post-brew annotations', () => {
    const brewOnly = () => [
      {
        id: 'bev-cap',
        name: 'Cappuccino',
        steps: [routineStep('brew', {}, 'step-brew')],
      },
    ];

    const gatewaySummary = (
      over: Partial<GatewayShotSummary> = {},
    ): GatewayShotSummary => ({
      id: 'shot-real',
      timestamp: '2026-05-27T08:00:10.000Z',
      workflow: {
        name: 'Cappuccino',
        profile: { title: 'Best Practice C+' },
        context: { targetDoseWeight: 18 },
      },
      ...over,
    });

    const driveToResult = async (
      env: ReturnType<typeof renderScreen>,
    ): Promise<void> => {
      fireEvent.click(
        await waitFor(() => screen.getByTestId('prep-card-start')),
      );
      env.setMachineSnap(snapshotWithState('espresso'));
      env.setMachineSnap(snapshotWithState('idle'));
      await waitFor(() => screen.getByTestId('post-brew-view'));
    };

    it('auto-saves the enjoyment rating against the real gateway shot id', async () => {
      const env = renderScreen({
        routines: brewOnly(),
        recipes: [sampleRecipe()],
        fetchLatestShot: () => Promise.resolve(gatewaySummary()),
      });
      await driveToResult(env);

      const slider = await waitFor(() => screen.getByTestId('post-brew-rating'));
      fireEvent.input(slider, { target: { value: '80' } });

      await waitFor(() =>
        expect(env.updateShot).toHaveBeenCalledWith(
          'shot-real',
          expect.objectContaining({ enjoyment: 80 }),
        ),
      );
      // Rating-only save must not assert a measured dose it never captured.
      expect(env.updateShot).not.toHaveBeenCalledWith(
        'shot-real',
        expect.objectContaining({ actualDoseWeight: expect.anything() }),
      );
    });

    it('auto-saves tasting notes', async () => {
      const env = renderScreen({
        routines: brewOnly(),
        recipes: [sampleRecipe()],
        fetchLatestShot: () => Promise.resolve(gatewaySummary()),
      });
      await driveToResult(env);

      const notes = await waitFor(() => screen.getByTestId('post-brew-notes'));
      fireEvent.input(notes, { target: { value: 'Bright, jammy' } });

      await waitFor(() =>
        expect(env.updateShot).toHaveBeenCalledWith(
          'shot-real',
          expect.objectContaining({ espressoNotes: 'Bright, jammy' }),
        ),
      );
    });

    it('saves a corrected actual dose only after it is edited', async () => {
      const env = renderScreen({
        routines: brewOnly(),
        recipes: [sampleRecipe()],
        fetchLatestShot: () => Promise.resolve(gatewaySummary()),
      });
      await driveToResult(env);

      const dose = await waitFor(() =>
        screen.getByTestId('post-brew-dose-input'),
      );
      // Seeded from the target dose (18) for display.
      expect(dose).toHaveValue(18);
      fireEvent.input(dose, { target: { value: '18.4' } });
      fireEvent.blur(dose);

      await waitFor(() =>
        expect(env.updateShot).toHaveBeenCalledWith(
          'shot-real',
          expect.objectContaining({ actualDoseWeight: 18.4 }),
        ),
      );
    });

    it('marks the capture Saved after a successful write', async () => {
      const env = renderScreen({
        routines: brewOnly(),
        recipes: [sampleRecipe()],
        fetchLatestShot: () => Promise.resolve(gatewaySummary()),
      });
      await driveToResult(env);

      const slider = await waitFor(() => screen.getByTestId('post-brew-rating'));
      fireEvent.input(slider, { target: { value: '60' } });

      await waitFor(() =>
        expect(screen.getByTestId('post-brew-save-state')).toHaveAttribute(
          'data-state',
          'saved',
        ),
      );
    });

    it('holds the save while only the optimistic record is on screen', async () => {
      const optimistic: GatewayShotRecord = {
        id: 'optimistic-synthetic',
        timestamp: '2026-05-27T08:00:10.000Z',
        workflow: { name: 'Cappuccino', profile: { title: 'C+' } },
        measurements: [],
      };
      const env = renderScreen({
        routines: brewOnly(),
        recipes: [sampleRecipe()],
        optimisticShot: optimistic,
        // fetchLatestShot rejects (default) → gateway never catches up, so
        // there is no real id to annotate.
      });
      await driveToResult(env);

      const slider = await waitFor(() => screen.getByTestId('post-brew-rating'));
      fireEvent.input(slider, { target: { value: '70' } });

      // Let the (zero-delay) debounce + bounded poll churn.
      await Promise.resolve();
      await Promise.resolve();

      expect(env.updateShot).not.toHaveBeenCalled();
      expect(screen.getByTestId('post-brew-save-state')).toHaveAttribute(
        'data-state',
        'saving',
      );
    });
  });

  describe('back arrow', () => {
    it('clicking back calls onExit', async () => {
      const env = renderScreen({
        routines: [cappuccino()],
        recipes: [sampleRecipe()],
      });
      fireEvent.click(await waitFor(() => screen.getByTestId('brew-back-button')));
      expect(env.onExit).toHaveBeenCalledOnce();
    });
  });
});
