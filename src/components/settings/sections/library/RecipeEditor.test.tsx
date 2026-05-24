import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { RecipeEditor } from './RecipeEditor';
import { WithRepositories } from '../../../../test/repositories';
import {
  LocalBeverageRepository,
  LocalRecipeRepository,
} from '../../../../repositories';
import { MemoryStorage } from '../../../../test/memoryStorage';
import { beverageStep } from '../../../../domain';
import type { Beverage, Recipe } from '../../../../domain';

interface SeedOpts {
  beverages?: Beverage[];
  recipes?: Recipe[];
}

const seedRepos = ({ beverages = [], recipes = [] }: SeedOpts) => {
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

const cappuccinoBev = (id = 'bev-cap'): Beverage => ({
  id,
  name: 'Cappuccino',
  steps: [beverageStep('brew', {}), beverageStep('steam', {})],
});

const espressoBev = (id = 'bev-esp'): Beverage => ({
  id,
  name: 'Espresso',
  steps: [beverageStep('brew', {})],
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

const renderEditor = (opts: SeedOpts, recipeId = 'rec-1') => {
  const repos = seedRepos(opts);
  const onClose = vi.fn();
  render(() => (
    <WithRepositories beverages={repos.beverages} recipes={repos.recipes}>
      <RecipeEditor recipeId={recipeId} onClose={onClose} debounceMs={0} />
    </WithRepositories>
  ));
  return { repos, onClose };
};

describe('RecipeEditor', () => {
  describe('loading + not-found', () => {
    it('renders not-found when the id does not exist', async () => {
      renderEditor({ recipes: [] }, 'missing');
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(/not found/i),
      );
    });
  });

  describe('name editing', () => {
    it('persists a renamed recipe on change', async () => {
      const { repos } = renderEditor({
        beverages: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      const input = (await waitFor(() =>
        screen.getByTestId('recipe-name-input'),
      )) as HTMLInputElement;
      input.value = 'Indonesia X';
      fireEvent.change(input);
      await waitFor(async () => {
        const r = await repos.recipes.get('rec-1');
        expect(r?.name).toBe('Indonesia X');
      });
    });

    it('ignores whitespace-only names', async () => {
      const { repos } = renderEditor({
        beverages: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      const input = (await waitFor(() =>
        screen.getByTestId('recipe-name-input'),
      )) as HTMLInputElement;
      input.value = '  ';
      fireEvent.change(input);
      expect((await repos.recipes.get('rec-1'))?.name).toBe("Wife's");
    });
  });

  describe('beverage re-target', () => {
    it('lists all visible beverages and seeds the current selection', async () => {
      renderEditor({
        beverages: [cappuccinoBev(), espressoBev()],
        recipes: [sampleRecipe()],
      });
      const select = (await waitFor(() =>
        screen.getByTestId('recipe-beverage-select'),
      )) as HTMLSelectElement;
      expect(select.value).toBe('bev-cap');
      expect(select.options).toHaveLength(2);
    });

    it('changing the beverage persists the new beverageId', async () => {
      const { repos } = renderEditor({
        beverages: [cappuccinoBev(), espressoBev()],
        recipes: [sampleRecipe()],
      });
      const select = (await waitFor(() =>
        screen.getByTestId('recipe-beverage-select'),
      )) as HTMLSelectElement;
      select.value = 'bev-esp';
      fireEvent.change(select);
      await waitFor(async () => {
        const r = await repos.recipes.get('rec-1');
        expect(r?.beverageId).toBe('bev-esp');
      });
    });

    it('keeps a missing parent beverage selectable so the editor opens cleanly', async () => {
      renderEditor({
        beverages: [],
        recipes: [sampleRecipe({ beverageId: 'gone' })],
      });
      const select = (await waitFor(() =>
        screen.getByTestId('recipe-beverage-select'),
      )) as HTMLSelectElement;
      expect(select.value).toBe('gone');
      expect(select).toHaveTextContent(/missing beverage/i);
    });

    it('renders the parent Beverage step-sequence hint below the select', async () => {
      renderEditor({
        beverages: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      const seq = await waitFor(() =>
        screen.getByTestId('recipe-beverage-sequence'),
      );
      // cappuccinoBev() seeds [brew, steam].
      expect(seq).toHaveTextContent('Brew → Steam');
    });

    it('sequence hint updates when the user re-targets the Beverage', async () => {
      renderEditor({
        beverages: [
          cappuccinoBev(),
          { id: 'bev-flush-only', name: 'Flush-only', steps: [beverageStep('flush', {})] },
        ],
        recipes: [sampleRecipe()],
      });
      const select = (await waitFor(() =>
        screen.getByTestId('recipe-beverage-select'),
      )) as HTMLSelectElement;
      select.value = 'bev-flush-only';
      fireEvent.change(select);
      await waitFor(() =>
        expect(screen.getByTestId('recipe-beverage-sequence')).toHaveTextContent(
          /^Flush$/,
        ),
      );
    });

    it('falls back to "(no steps yet)" when the parent has no steps', async () => {
      renderEditor({
        beverages: [{ id: 'bev-empty', name: 'Blank', steps: [] }],
        recipes: [sampleRecipe({ beverageId: 'bev-empty' })],
      });
      await waitFor(() =>
        expect(screen.getByTestId('recipe-beverage-sequence')).toHaveTextContent(
          /no steps yet/i,
        ),
      );
    });
  });

  describe('brewing fields', () => {
    it('seeds dose + grinder setting from storage', async () => {
      renderEditor({
        beverages: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      const dose = (await waitFor(() =>
        screen.getByTestId('recipe-dose-input'),
      )) as HTMLInputElement;
      const grinder = screen.getByTestId(
        'recipe-grinder-setting-input',
      ) as HTMLInputElement;
      expect(dose.value).toBe('18');
      expect(grinder.value).toBe('4.5');
    });

    it('edits dose and persists', async () => {
      const { repos } = renderEditor({
        beverages: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      const dose = (await waitFor(() =>
        screen.getByTestId('recipe-dose-input'),
      )) as HTMLInputElement;
      dose.value = '19.5';
      fireEvent.input(dose);
      await waitFor(async () => {
        const r = await repos.recipes.get('rec-1');
        expect(r?.doseGrams).toBe(19.5);
      });
    });

    it('clearing dose stores undefined', async () => {
      const { repos } = renderEditor({
        beverages: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      const dose = (await waitFor(() =>
        screen.getByTestId('recipe-dose-input'),
      )) as HTMLInputElement;
      dose.value = '';
      fireEvent.input(dose);
      await waitFor(async () => {
        const r = await repos.recipes.get('rec-1');
        expect(r?.doseGrams).toBeUndefined();
      });
    });

    it('edits grinder setting and persists', async () => {
      const { repos } = renderEditor({
        beverages: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      const g = (await waitFor(() =>
        screen.getByTestId('recipe-grinder-setting-input'),
      )) as HTMLInputElement;
      g.value = '5';
      fireEvent.input(g);
      await waitFor(async () => {
        const r = await repos.recipes.get('rec-1');
        expect(r?.grinderSetting).toBe(5);
      });
    });
  });

  describe('coming-soon stubs', () => {
    it('renders disabled placeholders for Bean / Grinder / Profile', async () => {
      renderEditor({
        beverages: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      const heading = await waitFor(() => screen.getByText('Coming soon'));
      // The stubs are siblings in the same section.
      const section = heading.parentElement!;
      expect(section).toHaveTextContent('Bean');
      expect(section).toHaveTextContent('Grinder');
      expect(section).toHaveTextContent('Espresso profile');
      // All three carry the "library not built" note.
      expect(section.textContent?.match(/library not built/gi) ?? []).toHaveLength(3);
    });
  });

  describe('delete', () => {
    it('confirms then deletes and closes the editor', async () => {
      const { repos, onClose } = renderEditor({
        beverages: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      await waitFor(() => screen.getByTestId('delete-recipe-button'));
      fireEvent.click(screen.getByTestId('delete-recipe-button'));
      expect(screen.getByTestId('delete-confirm')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('confirm-delete-recipe-button'));
      await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
      expect(await repos.recipes.get('rec-1')).toBeNull();
    });

    it('cancel keeps the recipe', async () => {
      const { repos, onClose } = renderEditor({
        beverages: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      await waitFor(() => screen.getByTestId('delete-recipe-button'));
      fireEvent.click(screen.getByTestId('delete-recipe-button'));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByTestId('delete-confirm')).not.toBeInTheDocument();
      expect(await repos.recipes.get('rec-1')).not.toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
