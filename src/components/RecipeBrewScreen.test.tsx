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
  opts: SeedOpts & { recipeId?: string },
): ReturnType<typeof mkSetup> => {
  const env = mkSetup({ beverages: opts.beverages, recipes: opts.recipes });
  render(() => (
    <WithRepositories beverages={env.repos.beverages} recipes={env.repos.recipes}>
      <RecipeBrewScreen
        recipeId={opts.recipeId ?? 'rec-1'}
        onExit={env.onExit}
        machineStream={() => env.machineStream}
        requestState={env.requestState}
      />
    </WithRepositories>
  ));
  return env;
};

const cappuccino = (): Beverage => ({
  id: 'bev-cap',
  name: 'Cappuccino',
  steps: [
    beverageStep('brew', {}, 'step-brew'),
    beverageStep('flush', {}, 'step-flush'),
    beverageStep('steam', { autoPurgeTimeSec: 5 }, 'step-steam'),
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
    it('shows brew prep with dose, grinder setting, profile placeholder', async () => {
      renderScreen({ beverages: [cappuccino()], recipes: [sampleRecipe()] });
      const card = await waitFor(() => screen.getByTestId('prep-card'));
      expect(card).toHaveTextContent('Dose');
      expect(card).toHaveTextContent('18');
      expect(card).toHaveTextContent('Grinder setting');
      expect(card).toHaveTextContent('4.5');
      expect(card).toHaveTextContent(/Profile library not built/i);
    });

    it('shows steam prep describing the purge mode', async () => {
      renderScreen({
        beverages: [
          {
            id: 'bev-cap',
            name: 'Cappuccino',
            steps: [beverageStep('steam', { autoPurgeTimeSec: 7 }, 'step-steam')],
          },
        ],
        recipes: [sampleRecipe()],
      });
      const card = await waitFor(() => screen.getByTestId('prep-card-steam'));
      expect(card).toHaveTextContent(/Purge/i);
      expect(card).toHaveTextContent(/Auto/i);
      expect(card).toHaveTextContent('7s');
    });

    it('shows manual purge copy when autoPurgeTimeSec is missing', async () => {
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
      const card = await waitFor(() => screen.getByTestId('prep-card-steam'));
      expect(card).toHaveTextContent(/Manual/i);
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
