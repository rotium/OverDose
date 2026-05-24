import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
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
  it('renders one row per recipe with name + parent beverage name + step sequence', async () => {
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
          steps: [
            beverageStep('brew', {}),
            beverageStep('flush', {}),
            beverageStep('steam', {}),
          ],
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
    expect(screen.getByTestId('recipe-row-r1-sequence')).toHaveTextContent(
      'Brew → Flush → Steam',
    );
    expect(screen.getByTestId('recipe-row-r2')).toHaveTextContent('Indonesia X');
    expect(screen.getByTestId('recipe-row-r2-sequence')).toHaveTextContent(
      'Brew → Flush → Steam',
    );
  });

  it('shows "(no steps yet)" when the parent Beverage has no steps', async () => {
    const repos = seed(
      [{ id: 'r1', name: 'A', beverageId: 'empty-bev', overrides: {} }],
      [{ id: 'empty-bev', name: 'Blank', steps: [] }],
    );
    render(() => (
      <WithRepositories beverages={repos.beverages} recipes={repos.recipes}>
        <RecipesSection />
      </WithRepositories>
    ));
    await waitFor(() =>
      expect(screen.getByTestId('recipe-row-r1-sequence')).toHaveTextContent(
        /no steps yet/i,
      ),
    );
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

  describe('list ↔ side-sheet editor', () => {
    it('clicking a row opens the editor for that recipe', async () => {
      const repos = seed(
        [{ id: 'r1', name: "Wife's", beverageId: 'b1', overrides: {} }],
        [
          {
            id: 'b1',
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
      await waitFor(() => screen.getByTestId('recipe-row-r1'));
      fireEvent.click(screen.getByTestId('recipe-row-r1'));
      await waitFor(() => screen.getByTestId('recipe-editor'));
      expect(
        (screen.getByTestId('recipe-name-input') as HTMLInputElement).value,
      ).toBe("Wife's");
    });

    it('Escape closes the sheet', async () => {
      const repos = seed(
        [{ id: 'r1', name: 'A', beverageId: 'b1', overrides: {} }],
        [
          {
            id: 'b1',
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
      await waitFor(() => screen.getByTestId('recipe-row-r1'));
      fireEvent.click(screen.getByTestId('recipe-row-r1'));
      await waitFor(() => screen.getByTestId('recipe-editor'));
      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(
        () =>
          expect(screen.queryByTestId('recipe-editor')).not.toBeInTheDocument(),
        { timeout: 600 },
      );
    });
  });

  describe('create new recipe', () => {
    it('disables the + button when no beverages exist', async () => {
      const repos = seed([], []);
      render(() => (
        <WithRepositories beverages={repos.beverages} recipes={repos.recipes}>
          <RecipesSection />
        </WithRepositories>
      ));
      const btn = (await waitFor(() =>
        screen.getByTestId('open-new-recipe'),
      )) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('reveals the form with name + beverage picker pre-selected', async () => {
      const repos = seed(
        [],
        [
          {
            id: 'b1',
            name: 'Cappuccino',
            steps: [beverageStep('brew', {})],
          },
          {
            id: 'b2',
            name: 'Espresso',
            steps: [beverageStep('brew', {})],
          },
        ],
      );
      render(() => (
        <WithRepositories beverages={repos.beverages} recipes={repos.recipes}>
          <RecipesSection />
        </WithRepositories>
      ));
      fireEvent.click(await waitFor(() => screen.getByTestId('open-new-recipe')));
      const select = (await waitFor(() =>
        screen.getByTestId('new-recipe-beverage'),
      )) as HTMLSelectElement;
      // First visible beverage seeds the picker.
      expect(select.value).toBe('b1');
      expect(select.options).toHaveLength(2);
    });

    it('submitting persists the new recipe and opens the editor', async () => {
      const repos = seed(
        [],
        [
          {
            id: 'b1',
            name: 'Cappuccino',
            steps: [beverageStep('brew', {})],
          },
          {
            id: 'b2',
            name: 'Espresso',
            steps: [beverageStep('brew', {})],
          },
        ],
      );
      render(() => (
        <WithRepositories beverages={repos.beverages} recipes={repos.recipes}>
          <RecipesSection />
        </WithRepositories>
      ));
      fireEvent.click(await waitFor(() => screen.getByTestId('open-new-recipe')));

      // Pick the non-default beverage so the assertion below verifies the
      // editor actually honoured the choice (not just rendered the first option).
      const picker = screen.getByTestId('new-recipe-beverage') as HTMLSelectElement;
      picker.value = 'b2';
      fireEvent.change(picker);

      const name = screen.getByTestId('new-recipe-name') as HTMLInputElement;
      name.value = 'Indonesia X';
      fireEvent.input(name);
      fireEvent.click(screen.getByTestId('confirm-new-recipe'));

      await waitFor(() => screen.getByTestId('recipe-editor'));
      expect(
        (screen.getByTestId('recipe-name-input') as HTMLInputElement).value,
      ).toBe('Indonesia X');

      // Editor select reflects the beverage we picked (not the first one).
      await waitFor(() =>
        expect(
          (screen.getByTestId('recipe-beverage-select') as HTMLSelectElement)
            .value,
        ).toBe('b2'),
      );

      // Underlying recipe exists with the picked beverage.
      const all = await repos.recipes.list();
      expect(all).toHaveLength(1);
      expect(all[0]?.beverageId).toBe('b2');
    });

    it('Cancel collapses the form without creating', async () => {
      const repos = seed(
        [],
        [
          {
            id: 'b1',
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
      fireEvent.click(await waitFor(() => screen.getByTestId('open-new-recipe')));
      fireEvent.click(screen.getByTestId('cancel-new-recipe'));
      expect(screen.queryByTestId('new-recipe-form')).not.toBeInTheDocument();
      expect(await repos.recipes.list()).toHaveLength(0);
    });
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
