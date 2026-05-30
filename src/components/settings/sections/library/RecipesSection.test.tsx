import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { RecipesSection } from './RecipesSection';
import { WithRepositories } from '../../../../test/repositories';
import { WithPrefs } from '../../../../test/prefs';
import {
  LocalRoutineRepository,
  LocalRecipeRepository,
} from '../../../../repositories';
import { MemoryStorage } from '../../../../test/memoryStorage';
import { routineStep } from '../../../../domain';
import type { Routine, Recipe } from '../../../../domain';

const seed = (recipes: Recipe[], routines: Routine[]) => {
  const recStore = new MemoryStorage();
  recStore.setItem('starter-skin.recipes.v1', JSON.stringify(recipes));
  recStore.setItem('starter-skin.recipes.seeded.v1', '1');
  const bevStore = new MemoryStorage();
  bevStore.setItem('starter-skin.routines.v1', JSON.stringify(routines));
  bevStore.setItem('starter-skin.routines.seeded.v1', '1');
  return {
    recipes: new LocalRecipeRepository(recStore),
    routines: new LocalRoutineRepository(bevStore),
  };
};

describe('RecipesSection', () => {
  it('renders one row per recipe with name + parent routine name + step sequence', async () => {
    const repos = seed(
      [
        {
          id: 'r1',
          name: "Wife's",
          routineId: 'cappuccino',
          overrides: {},
        },
        {
          id: 'r2',
          name: 'Indonesia X',
          routineId: 'cappuccino',
          overrides: {},
        },
      ],
      [
        {
          id: 'cappuccino',
          name: 'Cappuccino',
          steps: [
            routineStep('brew', {}),
            routineStep('flush', {}),
            routineStep('steam', {}),
          ],
        },
      ],
    );
    render(() => (
      <WithPrefs>
        <WithRepositories routines={repos.routines} recipes={repos.recipes}>
        <RecipesSection />
        </WithRepositories>
      </WithPrefs>
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

  it('shows "(no steps yet)" when the parent Routine has no steps', async () => {
    const repos = seed(
      [{ id: 'r1', name: 'A', routineId: 'empty-bev', overrides: {} }],
      [{ id: 'empty-bev', name: 'Blank', steps: [] }],
    );
    render(() => (
      <WithPrefs>
        <WithRepositories routines={repos.routines} recipes={repos.recipes}>
        <RecipesSection />
        </WithRepositories>
      </WithPrefs>
    ));
    await waitFor(() =>
      expect(screen.getByTestId('recipe-row-r1-sequence')).toHaveTextContent(
        /no steps yet/i,
      ),
    );
  });

  it('falls back to "(missing routine)" when the referenced Routine is gone', async () => {
    const repos = seed(
      [
        {
          id: 'orphan',
          name: 'Orphan',
          routineId: 'deleted-bev',
          overrides: {},
        },
      ],
      [],
    );
    render(() => (
      <WithPrefs>
        <WithRepositories routines={repos.routines} recipes={repos.recipes}>
        <RecipesSection />
        </WithRepositories>
      </WithPrefs>
    ));
    await waitFor(() =>
      expect(screen.getByTestId('recipe-row-orphan')).toHaveTextContent(
        /missing routine/i,
      ),
    );
  });

  it('shows an empty-state message when there are no recipes', async () => {
    const repos = seed([], []);
    render(() => (
      <WithPrefs>
        <WithRepositories routines={repos.routines} recipes={repos.recipes}>
        <RecipesSection />
        </WithRepositories>
      </WithPrefs>
    ));
    await waitFor(() => screen.getByText(/no recipes yet/i));
  });

  describe('list ↔ side-sheet editor', () => {
    it('clicking a row opens the editor for that recipe', async () => {
      const repos = seed(
        [{ id: 'r1', name: "Wife's", routineId: 'b1', overrides: {} }],
        [
          {
            id: 'b1',
            name: 'Cappuccino',
            steps: [routineStep('brew', {})],
          },
        ],
      );
      render(() => (
        <WithPrefs>
        <WithRepositories routines={repos.routines} recipes={repos.recipes}>
          <RecipesSection />
          </WithRepositories>
      </WithPrefs>
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
        [{ id: 'r1', name: 'A', routineId: 'b1', overrides: {} }],
        [
          {
            id: 'b1',
            name: 'Cappuccino',
            steps: [routineStep('brew', {})],
          },
        ],
      );
      render(() => (
        <WithPrefs>
        <WithRepositories routines={repos.routines} recipes={repos.recipes}>
          <RecipesSection />
          </WithRepositories>
      </WithPrefs>
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
    it('disables the + button when no routines exist', async () => {
      const repos = seed([], []);
      render(() => (
        <WithPrefs>
        <WithRepositories routines={repos.routines} recipes={repos.recipes}>
          <RecipesSection />
          </WithRepositories>
      </WithPrefs>
      ));
      const btn = (await waitFor(() =>
        screen.getByTestId('open-new-recipe'),
      )) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('reveals the form with name + routine picker pre-selected', async () => {
      const repos = seed(
        [],
        [
          {
            id: 'b1',
            name: 'Cappuccino',
            steps: [routineStep('brew', {})],
          },
          {
            id: 'b2',
            name: 'Espresso',
            steps: [routineStep('brew', {})],
          },
        ],
      );
      render(() => (
        <WithPrefs>
        <WithRepositories routines={repos.routines} recipes={repos.recipes}>
          <RecipesSection />
          </WithRepositories>
      </WithPrefs>
      ));
      fireEvent.click(await waitFor(() => screen.getByTestId('open-new-recipe')));
      const select = (await waitFor(() =>
        screen.getByTestId('new-recipe-routine'),
      )) as HTMLSelectElement;
      // First visible routine seeds the picker.
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
            steps: [routineStep('brew', {})],
          },
          {
            id: 'b2',
            name: 'Espresso',
            steps: [routineStep('brew', {})],
          },
        ],
      );
      render(() => (
        <WithPrefs>
        <WithRepositories routines={repos.routines} recipes={repos.recipes}>
          <RecipesSection />
          </WithRepositories>
      </WithPrefs>
      ));
      fireEvent.click(await waitFor(() => screen.getByTestId('open-new-recipe')));

      // Pick the non-default routine so the assertion below verifies the
      // editor actually honoured the choice (not just rendered the first option).
      const picker = screen.getByTestId('new-recipe-routine') as HTMLSelectElement;
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

      // Editor select reflects the routine we picked (not the first one).
      await waitFor(() =>
        expect(
          (screen.getByTestId('recipe-routine-select') as HTMLSelectElement)
            .value,
        ).toBe('b2'),
      );

      // Underlying recipe exists with the picked routine.
      const all = await repos.recipes.list();
      expect(all).toHaveLength(1);
      expect(all[0]?.routineId).toBe('b2');
    });

    it('Cancel collapses the form without creating', async () => {
      const repos = seed(
        [],
        [
          {
            id: 'b1',
            name: 'Cappuccino',
            steps: [routineStep('brew', {})],
          },
        ],
      );
      render(() => (
        <WithPrefs>
        <WithRepositories routines={repos.routines} recipes={repos.recipes}>
          <RecipesSection />
          </WithRepositories>
      </WithPrefs>
      ));
      fireEvent.click(await waitFor(() => screen.getByTestId('open-new-recipe')));
      fireEvent.click(screen.getByTestId('cancel-new-recipe'));
      expect(screen.queryByTestId('new-recipe-form')).not.toBeInTheDocument();
      expect(await repos.recipes.list()).toHaveLength(0);
    });
  });

  it('lists Recipes whose parent Routine is hidden (resolves via list, not listVisible)', async () => {
    const repos = seed(
      [
        {
          id: 'detached',
          name: 'My Detached Recipe',
          routineId: 'bev-hidden',
          overrides: {},
        },
      ],
      [
        {
          id: 'bev-hidden',
          name: 'Hidden Routine',
          hidden: true,
          steps: [routineStep('brew', {})],
        },
      ],
    );
    render(() => (
      <WithPrefs>
        <WithRepositories routines={repos.routines} recipes={repos.recipes}>
        <RecipesSection />
        </WithRepositories>
      </WithPrefs>
    ));
    await waitFor(() =>
      expect(screen.getByTestId('recipe-row-detached')).toHaveTextContent(
        'Hidden Routine',
      ),
    );
  });

  it('hides a recipe via the row eye toggle', async () => {
    const repos = seed(
      [{ id: 'r1', name: 'Indonesia X', routineId: 'cappuccino', overrides: {} }],
      [
        {
          id: 'cappuccino',
          name: 'Cappuccino',
          steps: [routineStep('brew', {})],
        },
      ],
    );
    render(() => (
      <WithPrefs>
        <WithRepositories routines={repos.routines} recipes={repos.recipes}>
          <RecipesSection />
        </WithRepositories>
      </WithPrefs>
    ));

    const toggle = await waitFor(() =>
      screen.getByTestId('recipe-row-r1-toggle-hidden'),
    );
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);

    // Row reflects hidden (dimmed marker) + the toggle flips, and it's
    // persisted on the recipe.
    await waitFor(() =>
      expect(
        screen.getByTestId('recipe-row-r1-toggle-hidden'),
      ).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(screen.getByTestId('recipe-row-r1-item')).toHaveAttribute(
      'data-hidden',
      'true',
    );
    expect((await repos.recipes.list())[0].hidden).toBe(true);
  });
});
