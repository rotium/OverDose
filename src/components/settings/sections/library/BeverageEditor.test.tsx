import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { BeverageEditor } from './BeverageEditor';
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

const sampleBeverage = (over: Partial<Beverage> = {}): Beverage => ({
  id: 'bev-1',
  name: 'Cappuccino',
  steps: [
    beverageStep('brew', { targetYieldGrams: 36 }, 'step-brew'),
    beverageStep('flush', {}, 'step-flush'),
    beverageStep('steam', { durationSec: 30 }, 'step-steam'),
  ],
  ...over,
});

const renderEditor = (opts: SeedOpts, beverageId = 'bev-1') => {
  const repos = seedRepos(opts);
  const onClose = vi.fn();
  render(() => (
    <WithRepositories beverages={repos.beverages} recipes={repos.recipes}>
      <BeverageEditor beverageId={beverageId} onClose={onClose} />
    </WithRepositories>
  ));
  return { repos, onClose };
};

describe('BeverageEditor', () => {
  describe('loading + not-found', () => {
    it('renders not-found state when the id does not exist', async () => {
      renderEditor({ beverages: [] }, 'missing');
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not found/i));
    });
  });

  describe('name editing', () => {
    it('persists a renamed beverage on change', async () => {
      const { repos } = renderEditor({ beverages: [sampleBeverage()] });
      await waitFor(() => screen.getByTestId('beverage-name-input'));
      const input = screen.getByTestId('beverage-name-input') as HTMLInputElement;
      input.value = 'Latte';
      fireEvent.change(input);
      await waitFor(async () => {
        const b = await repos.beverages.get('bev-1');
        expect(b?.name).toBe('Latte');
      });
    });

    it('ignores empty / whitespace-only names', async () => {
      const { repos } = renderEditor({ beverages: [sampleBeverage()] });
      await waitFor(() => screen.getByTestId('beverage-name-input'));
      const input = screen.getByTestId('beverage-name-input') as HTMLInputElement;
      input.value = '   ';
      fireEvent.change(input);
      // Storage still has the original name.
      const b = await repos.beverages.get('bev-1');
      expect(b?.name).toBe('Cappuccino');
    });

    it('does not write when the name is unchanged', async () => {
      const { repos } = renderEditor({ beverages: [sampleBeverage()] });
      await waitFor(() => screen.getByTestId('beverage-name-input'));
      const spy = vi.spyOn(repos.beverages, 'update');
      const input = screen.getByTestId('beverage-name-input') as HTMLInputElement;
      input.value = 'Cappuccino';
      fireEvent.change(input);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('steps list (read-only)', () => {
    it('renders one row per step with numbered prefix + capitalised type', async () => {
      renderEditor({ beverages: [sampleBeverage()] });
      await waitFor(() => screen.getByTestId('beverage-steps-list'));
      expect(screen.getByTestId('beverage-step-step-brew')).toHaveTextContent(
        '1. Brew',
      );
      expect(screen.getByTestId('beverage-step-step-flush')).toHaveTextContent(
        '2. Flush',
      );
      expect(screen.getByTestId('beverage-step-step-steam')).toHaveTextContent(
        '3. Steam',
      );
    });

    it('renders empty-state when the beverage has no steps', async () => {
      renderEditor({
        beverages: [sampleBeverage({ steps: [] })],
      });
      await waitFor(() => screen.getByText(/no steps yet/i));
    });
  });

  describe('delete — no references', () => {
    it('shows confirm panel and deletes on confirm; closes the editor', async () => {
      const { repos, onClose } = renderEditor({
        beverages: [sampleBeverage()],
      });
      await waitFor(() => screen.getByTestId('delete-beverage-button'));

      fireEvent.click(screen.getByTestId('delete-beverage-button'));
      expect(screen.getByTestId('delete-confirm')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('confirm-delete-button'));

      await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
      expect(await repos.beverages.get('bev-1')).toBeNull();
    });

    it('cancel returns to the editor without deleting', async () => {
      const { repos, onClose } = renderEditor({
        beverages: [sampleBeverage()],
      });
      await waitFor(() => screen.getByTestId('delete-beverage-button'));

      fireEvent.click(screen.getByTestId('delete-beverage-button'));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByTestId('delete-confirm')).not.toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      expect(await repos.beverages.get('bev-1')).not.toBeNull();
    });
  });

  describe('usage hint', () => {
    it('shows "No Recipes use this Beverage yet." when unused', async () => {
      renderEditor({ beverages: [sampleBeverage()] });
      await waitFor(() =>
        expect(screen.getByTestId('beverage-usage-hint')).toHaveTextContent(
          /no recipes use this beverage yet/i,
        ),
      );
    });

    it('singularises when exactly one Recipe references', async () => {
      renderEditor({
        beverages: [sampleBeverage()],
        recipes: [
          { id: 'r1', name: 'A', beverageId: 'bev-1', overrides: {} },
        ],
      });
      await waitFor(() =>
        expect(screen.getByTestId('beverage-usage-hint')).toHaveTextContent(
          /^1 Recipe uses/i,
        ),
      );
    });

    it('pluralises when ≥2 Recipes reference', async () => {
      renderEditor({
        beverages: [sampleBeverage()],
        recipes: [
          { id: 'r1', name: 'A', beverageId: 'bev-1', overrides: {} },
          { id: 'r2', name: 'B', beverageId: 'bev-1', overrides: {} },
        ],
      });
      await waitFor(() =>
        expect(screen.getByTestId('beverage-usage-hint')).toHaveTextContent(
          /^2 Recipes use/i,
        ),
      );
    });
  });

  describe('step reorder', () => {
    it('moves a step down via the ↓ button and persists the new order', async () => {
      const { repos } = renderEditor({ beverages: [sampleBeverage()] });
      await waitFor(() => screen.getByTestId('beverage-steps-list'));

      fireEvent.click(screen.getByTestId('step-down-step-brew'));

      await waitFor(async () => {
        const b = await repos.beverages.get('bev-1');
        expect(b?.steps.map((s) => s.id)).toEqual([
          'step-flush',
          'step-brew',
          'step-steam',
        ]);
      });
    });

    it('moves a step up via the ↑ button', async () => {
      const { repos } = renderEditor({ beverages: [sampleBeverage()] });
      await waitFor(() => screen.getByTestId('beverage-steps-list'));

      fireEvent.click(screen.getByTestId('step-up-step-steam'));

      await waitFor(async () => {
        const b = await repos.beverages.get('bev-1');
        expect(b?.steps.map((s) => s.id)).toEqual([
          'step-brew',
          'step-steam',
          'step-flush',
        ]);
      });
    });

    it('disables ↑ on the first step and ↓ on the last step', async () => {
      renderEditor({ beverages: [sampleBeverage()] });
      await waitFor(() => screen.getByTestId('beverage-steps-list'));

      expect(screen.getByTestId('step-up-step-brew')).toBeDisabled();
      expect(screen.getByTestId('step-down-step-steam')).toBeDisabled();
      // Middle step has both enabled.
      expect(screen.getByTestId('step-up-step-flush')).not.toBeDisabled();
      expect(screen.getByTestId('step-down-step-flush')).not.toBeDisabled();
    });
  });

  describe('step remove', () => {
    it('removes a step and persists; row disappears', async () => {
      const { repos } = renderEditor({ beverages: [sampleBeverage()] });
      await waitFor(() => screen.getByTestId('beverage-step-step-flush'));

      fireEvent.click(screen.getByTestId('step-remove-step-flush'));

      await waitFor(() =>
        expect(screen.queryByTestId('beverage-step-step-flush')).not.toBeInTheDocument(),
      );
      const b = await repos.beverages.get('bev-1');
      expect(b?.steps.map((s) => s.id)).toEqual(['step-brew', 'step-steam']);
    });
  });

  describe('step add', () => {
    it('opens the picker, appends the picked type, and closes the picker', async () => {
      const { repos } = renderEditor({ beverages: [sampleBeverage()] });
      await waitFor(() => screen.getByTestId('open-add-step'));

      fireEvent.click(screen.getByTestId('open-add-step'));
      expect(screen.getByTestId('step-picker')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('add-step-water'));

      await waitFor(async () => {
        const b = await repos.beverages.get('bev-1');
        expect(b?.steps).toHaveLength(4);
        expect(b?.steps[3]?.type).toBe('water');
      });
      // Picker collapses again after pick.
      expect(screen.queryByTestId('step-picker')).not.toBeInTheDocument();
    });

    it('picker cancel closes without adding', async () => {
      const { repos } = renderEditor({ beverages: [sampleBeverage()] });
      await waitFor(() => screen.getByTestId('open-add-step'));

      fireEvent.click(screen.getByTestId('open-add-step'));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByTestId('step-picker')).not.toBeInTheDocument();
      const b = await repos.beverages.get('bev-1');
      expect(b?.steps).toHaveLength(3);
    });

    it('renders all 4 step types in the picker', async () => {
      renderEditor({ beverages: [sampleBeverage()] });
      await waitFor(() => screen.getByTestId('open-add-step'));
      fireEvent.click(screen.getByTestId('open-add-step'));

      for (const t of ['brew', 'steam', 'water', 'flush']) {
        expect(screen.getByTestId(`add-step-${t}`)).toBeInTheDocument();
      }
      // The retired step types must not appear in the picker.
      expect(screen.queryByTestId('add-step-weight')).not.toBeInTheDocument();
      expect(screen.queryByTestId('add-step-bean-selection')).not.toBeInTheDocument();
      expect(screen.queryByTestId('add-step-profile-selection')).not.toBeInTheDocument();
      expect(screen.queryByTestId('add-step-grind')).not.toBeInTheDocument();
    });

    it('appends an empty-config step (works with the empty steps list too)', async () => {
      const { repos } = renderEditor({
        beverages: [sampleBeverage({ steps: [] })],
      });
      await waitFor(() => screen.getByTestId('open-add-step'));
      fireEvent.click(screen.getByTestId('open-add-step'));
      fireEvent.click(screen.getByTestId('add-step-brew'));

      await waitFor(async () => {
        const b = await repos.beverages.get('bev-1');
        expect(b?.steps).toHaveLength(1);
        expect(b?.steps[0]?.type).toBe('brew');
        expect(b?.steps[0]?.config).toEqual({});
      });
    });
  });

  describe('delete — blocked by Recipes', () => {
    it('shows the blocking Recipes and offers only Cancel', async () => {
      const { repos, onClose } = renderEditor({
        beverages: [sampleBeverage()],
        recipes: [
          { id: 'r1', name: "Wife's", beverageId: 'bev-1', overrides: {} },
          { id: 'r2', name: 'Indonesia X', beverageId: 'bev-1', overrides: {} },
          { id: 'r3', name: 'Unrelated', beverageId: 'other-bev', overrides: {} },
        ],
      });
      await waitFor(() => screen.getByTestId('delete-beverage-button'));

      fireEvent.click(screen.getByTestId('delete-beverage-button'));
      const blocked = await waitFor(() => screen.getByTestId('delete-blocked'));

      expect(blocked).toHaveTextContent(/2 Recipes use/i);
      expect(blocked).toHaveTextContent("Wife's");
      expect(blocked).toHaveTextContent('Indonesia X');
      expect(blocked).not.toHaveTextContent('Unrelated');

      // No confirm button in the blocked panel.
      expect(screen.queryByTestId('confirm-delete-button')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(await repos.beverages.get('bev-1')).not.toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('uses singular "Recipe uses" when exactly one references', async () => {
      renderEditor({
        beverages: [sampleBeverage()],
        recipes: [
          { id: 'r1', name: 'Only', beverageId: 'bev-1', overrides: {} },
        ],
      });
      await waitFor(() => screen.getByTestId('delete-beverage-button'));
      fireEvent.click(screen.getByTestId('delete-beverage-button'));
      await waitFor(() =>
        expect(screen.getByTestId('delete-blocked')).toHaveTextContent(
          /1 Recipe uses/i,
        ),
      );
    });
  });
});
