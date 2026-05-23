import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@solidjs/testing-library';
import { RecipesSection } from './RecipesSection';
import { WithRepositories } from '../../../../test/repositories';
import {
  LocalBeverageRepository,
  LocalRecipeRepository,
} from '../../../../repositories';
import { MemoryStorage } from '../../../../test/memoryStorage';
import { beverageStep } from '../../../../domain';
import type { Beverage, Recipe } from '../../../../domain';

const seed = (recipes: Recipe[], beverages: Beverage[]) => {
  const recStore = new MemoryStorage();
  recStore.setItem('starter-skin.recipes.v1', JSON.stringify(recipes));
  recStore.setItem('starter-skin.recipes.seeded.v1', '1');
  const bevStore = new MemoryStorage();
  bevStore.setItem('starter-skin.beverages.v1', JSON.stringify(beverages));
  bevStore.setItem('starter-skin.beverages.seeded.v1', '1');
  return {
    recipes: new LocalRecipeRepository(recStore),
    beverages: new LocalBeverageRepository(bevStore),
  };
};

describe('RecipesSection', () => {
  it('renders one row per recipe with name + parent beverage name', async () => {
    const repos = seed(
      [
        {
          id: 'r1',
          name: "Wife's",
          beverageId: 'cappuccino',
          overrides: {},
        },
        {
          id: 'r2',
          name: 'Indonesia X',
          beverageId: 'cappuccino',
          overrides: {},
        },
      ],
      [
        {
          id: 'cappuccino',
          name: 'Cappuccino',
          steps: [beverageStep('brew', {})],
        },
      ],
    );
    render(() => (
      <WithRepositories beverages={repos.beverages} recipes={repos.recipes}>
        <RecipesSection />
      </WithRepositories>
    ));
    await waitFor(() => screen.getByTestId('recipes-list'));
    expect(screen.getByTestId('recipe-row-r1')).toHaveTextContent("Wife's");
    expect(screen.getByTestId('recipe-row-r1')).toHaveTextContent('Cappuccino');
    expect(screen.getByTestId('recipe-row-r2')).toHaveTextContent('Indonesia X');
    expect(screen.getByTestId('recipe-row-r2')).toHaveTextContent('Cappuccino');
  });

  it('falls back to "(missing beverage)" when the referenced Beverage is gone', async () => {
    const repos = seed(
      [
        {
          id: 'orphan',
          name: 'Orphan',
          beverageId: 'deleted-bev',
          overrides: {},
        },
      ],
      [],
    );
    render(() => (
      <WithRepositories beverages={repos.beverages} recipes={repos.recipes}>
        <RecipesSection />
      </WithRepositories>
    ));
    await waitFor(() =>
      expect(screen.getByTestId('recipe-row-orphan')).toHaveTextContent(
        /missing beverage/i,
      ),
    );
  });

  it('shows an empty-state message when there are no recipes', async () => {
    const repos = seed([], []);
    render(() => (
      <WithRepositories beverages={repos.beverages} recipes={repos.recipes}>
        <RecipesSection />
      </WithRepositories>
    ));
    await waitFor(() => screen.getByText(/no recipes yet/i));
  });

  it('lists Recipes whose parent Beverage is hidden (resolves via list, not listVisible)', async () => {
    const repos = seed(
      [
        {
          id: 'detached',
          name: 'My Detached Recipe',
          beverageId: 'bev-hidden',
          overrides: {},
        },
      ],
      [
        {
          id: 'bev-hidden',
          name: 'Hidden Beverage',
          hidden: true,
          steps: [beverageStep('brew', {})],
        },
      ],
    );
    render(() => (
      <WithRepositories beverages={repos.beverages} recipes={repos.recipes}>
        <RecipesSection />
      </WithRepositories>
    ));
    await waitFor(() =>
      expect(screen.getByTestId('recipe-row-detached')).toHaveTextContent(
        'Hidden Beverage',
      ),
    );
  });
});
