import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { RoutineEditor } from './RoutineEditor';
import { WithRepositories } from '../../../../test/repositories';
import {
  LocalRoutineRepository,
  LocalRecipeRepository,
} from '../../../../repositories';
import { MemoryStorage } from '../../../../test/memoryStorage';
import { routineStep } from '../../../../domain';
import type { Routine, Recipe } from '../../../../domain';

interface SeedOpts {
  routines?: Routine[];
  recipes?: Recipe[];
}

const seedRepos = ({ routines = [], recipes = [] }: SeedOpts) => {
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

const sampleRoutine = (over: Partial<Routine> = {}): Routine => ({
  id: 'bev-1',
  name: 'Cappuccino',
  steps: [
    routineStep('brew', {}, 'step-brew'),
    routineStep('flush', {}, 'step-flush'),
    routineStep('steam', {}, 'step-steam'),
  ],
  ...over,
});

const renderEditor = (opts: SeedOpts, routineId = 'bev-1') => {
  const repos = seedRepos(opts);
  const onClose = vi.fn();
  render(() => (
    <WithRepositories routines={repos.routines} recipes={repos.recipes}>
      <RoutineEditor routineId={routineId} onClose={onClose} />
    </WithRepositories>
  ));
  return { repos, onClose };
};

describe('RoutineEditor', () => {
  describe('loading + not-found', () => {
    it('renders not-found state when the id does not exist', async () => {
      renderEditor({ routines: [] }, 'missing');
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not found/i));
    });
  });

  describe('name editing', () => {
    it('persists a renamed routine on change', async () => {
      const { repos } = renderEditor({ routines: [sampleRoutine()] });
      await waitFor(() => screen.getByTestId('routine-name-input'));
      const input = screen.getByTestId('routine-name-input') as HTMLInputElement;
      input.value = 'Latte';
      fireEvent.change(input);
      await waitFor(async () => {
        const b = await repos.routines.get('bev-1');
        expect(b?.name).toBe('Latte');
      });
    });

    it('ignores empty / whitespace-only names', async () => {
      const { repos } = renderEditor({ routines: [sampleRoutine()] });
      await waitFor(() => screen.getByTestId('routine-name-input'));
      const input = screen.getByTestId('routine-name-input') as HTMLInputElement;
      input.value = '   ';
      fireEvent.change(input);
      // Storage still has the original name.
      const b = await repos.routines.get('bev-1');
      expect(b?.name).toBe('Cappuccino');
    });

    it('does not write when the name is unchanged', async () => {
      const { repos } = renderEditor({ routines: [sampleRoutine()] });
      await waitFor(() => screen.getByTestId('routine-name-input'));
      const spy = vi.spyOn(repos.routines, 'update');
      const input = screen.getByTestId('routine-name-input') as HTMLInputElement;
      input.value = 'Cappuccino';
      fireEvent.change(input);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('steps list (read-only)', () => {
    it('renders one row per step with numbered prefix + capitalised type', async () => {
      renderEditor({ routines: [sampleRoutine()] });
      await waitFor(() => screen.getByTestId('routine-steps-list'));
      expect(screen.getByTestId('routine-step-step-brew')).toHaveTextContent(
        '1. Brew',
      );
      expect(screen.getByTestId('routine-step-step-flush')).toHaveTextContent(
        '2. Flush',
      );
      expect(screen.getByTestId('routine-step-step-steam')).toHaveTextContent(
        '3. Steam',
      );
    });

    it('renders empty-state when the routine has no steps', async () => {
      renderEditor({
        routines: [sampleRoutine({ steps: [] })],
      });
      await waitFor(() => screen.getByText(/no steps yet/i));
    });
  });

  describe('delete — no references', () => {
    it('shows confirm panel and deletes on confirm; closes the editor', async () => {
      const { repos, onClose } = renderEditor({
        routines: [sampleRoutine()],
      });
      await waitFor(() => screen.getByTestId('delete-routine-button'));

      fireEvent.click(screen.getByTestId('delete-routine-button'));
      expect(screen.getByTestId('delete-confirm')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('confirm-delete-button'));

      await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
      expect(await repos.routines.get('bev-1')).toBeNull();
    });

    it('cancel returns to the editor without deleting', async () => {
      const { repos, onClose } = renderEditor({
        routines: [sampleRoutine()],
      });
      await waitFor(() => screen.getByTestId('delete-routine-button'));

      fireEvent.click(screen.getByTestId('delete-routine-button'));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByTestId('delete-confirm')).not.toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      expect(await repos.routines.get('bev-1')).not.toBeNull();
    });
  });

  describe('usage hint', () => {
    it('shows "No Recipes use this Routine yet." when unused', async () => {
      renderEditor({ routines: [sampleRoutine()] });
      await waitFor(() =>
        expect(screen.getByTestId('routine-usage-hint')).toHaveTextContent(
          /no recipes use this routine yet/i,
        ),
      );
    });

    it('singularises when exactly one Recipe references', async () => {
      renderEditor({
        routines: [sampleRoutine()],
        recipes: [
          { id: 'r1', name: 'A', routineId: 'bev-1', overrides: {} },
        ],
      });
      await waitFor(() =>
        expect(screen.getByTestId('routine-usage-hint')).toHaveTextContent(
          /^1 Recipe uses/i,
        ),
      );
    });

    it('pluralises when ≥2 Recipes reference', async () => {
      renderEditor({
        routines: [sampleRoutine()],
        recipes: [
          { id: 'r1', name: 'A', routineId: 'bev-1', overrides: {} },
          { id: 'r2', name: 'B', routineId: 'bev-1', overrides: {} },
        ],
      });
      await waitFor(() =>
        expect(screen.getByTestId('routine-usage-hint')).toHaveTextContent(
          /^2 Recipes use/i,
        ),
      );
    });
  });

  describe('step reorder', () => {
    it('moves a step down via the ↓ button and persists the new order', async () => {
      const { repos } = renderEditor({ routines: [sampleRoutine()] });
      await waitFor(() => screen.getByTestId('routine-steps-list'));

      fireEvent.click(screen.getByTestId('step-down-step-brew'));

      await waitFor(async () => {
        const b = await repos.routines.get('bev-1');
        expect(b?.steps.map((s) => s.id)).toEqual([
          'step-flush',
          'step-brew',
          'step-steam',
        ]);
      });
    });

    it('moves a step up via the ↑ button', async () => {
      const { repos } = renderEditor({ routines: [sampleRoutine()] });
      await waitFor(() => screen.getByTestId('routine-steps-list'));

      fireEvent.click(screen.getByTestId('step-up-step-steam'));

      await waitFor(async () => {
        const b = await repos.routines.get('bev-1');
        expect(b?.steps.map((s) => s.id)).toEqual([
          'step-brew',
          'step-steam',
          'step-flush',
        ]);
      });
    });

    it('disables ↑ on the first step and ↓ on the last step', async () => {
      renderEditor({ routines: [sampleRoutine()] });
      await waitFor(() => screen.getByTestId('routine-steps-list'));

      expect(screen.getByTestId('step-up-step-brew')).toBeDisabled();
      expect(screen.getByTestId('step-down-step-steam')).toBeDisabled();
      // Middle step has both enabled.
      expect(screen.getByTestId('step-up-step-flush')).not.toBeDisabled();
      expect(screen.getByTestId('step-down-step-flush')).not.toBeDisabled();
    });
  });

  describe('step remove', () => {
    it('removes a step and persists; row disappears', async () => {
      const { repos } = renderEditor({ routines: [sampleRoutine()] });
      await waitFor(() => screen.getByTestId('routine-step-step-flush'));

      fireEvent.click(screen.getByTestId('step-remove-step-flush'));

      await waitFor(() =>
        expect(screen.queryByTestId('routine-step-step-flush')).not.toBeInTheDocument(),
      );
      const b = await repos.routines.get('bev-1');
      expect(b?.steps.map((s) => s.id)).toEqual(['step-brew', 'step-steam']);
    });
  });

  describe('step add', () => {
    it('opens the picker, appends the picked type, and closes the picker', async () => {
      const { repos } = renderEditor({ routines: [sampleRoutine()] });
      await waitFor(() => screen.getByTestId('open-add-step'));

      fireEvent.click(screen.getByTestId('open-add-step'));
      expect(screen.getByTestId('step-picker')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('add-step-water'));

      await waitFor(async () => {
        const b = await repos.routines.get('bev-1');
        expect(b?.steps).toHaveLength(4);
        expect(b?.steps[3]?.type).toBe('water');
      });
      // Picker collapses again after pick.
      expect(screen.queryByTestId('step-picker')).not.toBeInTheDocument();
    });

    it('picker cancel closes without adding', async () => {
      const { repos } = renderEditor({ routines: [sampleRoutine()] });
      await waitFor(() => screen.getByTestId('open-add-step'));

      fireEvent.click(screen.getByTestId('open-add-step'));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByTestId('step-picker')).not.toBeInTheDocument();
      const b = await repos.routines.get('bev-1');
      expect(b?.steps).toHaveLength(3);
    });

    it('renders all 4 step types in the picker', async () => {
      renderEditor({ routines: [sampleRoutine()] });
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
        routines: [sampleRoutine({ steps: [] })],
      });
      await waitFor(() => screen.getByTestId('open-add-step'));
      fireEvent.click(screen.getByTestId('open-add-step'));
      fireEvent.click(screen.getByTestId('add-step-brew'));

      await waitFor(async () => {
        const b = await repos.routines.get('bev-1');
        expect(b?.steps).toHaveLength(1);
        expect(b?.steps[0]?.type).toBe('brew');
        expect(b?.steps[0]?.config).toEqual({});
      });
    });
  });

  describe('delete — cascade through referencing Recipes', () => {
    it('lists referencing Recipes and gates Delete behind a checkbox', async () => {
      const { repos, onClose } = renderEditor({
        routines: [sampleRoutine()],
        recipes: [
          { id: 'r1', name: "Wife's", routineId: 'bev-1', overrides: {} },
          { id: 'r2', name: 'Indonesia X', routineId: 'bev-1', overrides: {} },
          { id: 'r3', name: 'Unrelated', routineId: 'other-bev', overrides: {} },
        ],
      });
      await waitFor(() => screen.getByTestId('delete-routine-button'));

      fireEvent.click(screen.getByTestId('delete-routine-button'));
      const blocked = await waitFor(() => screen.getByTestId('delete-blocked'));

      expect(blocked).toHaveTextContent(/2 Recipes use/i);
      expect(blocked).toHaveTextContent("Wife's");
      expect(blocked).toHaveTextContent('Indonesia X');
      expect(blocked).not.toHaveTextContent('Unrelated');

      // Delete is disabled until the cascade checkbox is ticked.
      const del = screen.getByTestId(
        'confirm-cascade-delete-button',
      ) as HTMLButtonElement;
      expect(del.disabled).toBe(true);

      // Clicking the disabled Delete is a no-op.
      fireEvent.click(del);
      expect(await repos.routines.get('bev-1')).not.toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('ticking the checkbox enables Delete and cascades through the Recipes', async () => {
      const { repos, onClose } = renderEditor({
        routines: [sampleRoutine()],
        recipes: [
          { id: 'r1', name: "Wife's", routineId: 'bev-1', overrides: {} },
          { id: 'r2', name: 'Indonesia X', routineId: 'bev-1', overrides: {} },
          { id: 'r3', name: 'Unrelated', routineId: 'other-bev', overrides: {} },
        ],
      });
      await waitFor(() => screen.getByTestId('delete-routine-button'));

      fireEvent.click(screen.getByTestId('delete-routine-button'));
      await waitFor(() => screen.getByTestId('delete-blocked'));

      fireEvent.click(screen.getByTestId('cascade-ack-checkbox'));
      const del = screen.getByTestId(
        'confirm-cascade-delete-button',
      ) as HTMLButtonElement;
      expect(del.disabled).toBe(false);

      fireEvent.click(del);

      await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
      expect(await repos.routines.get('bev-1')).toBeNull();
      // Referencing Recipes are gone; unrelated Recipes are untouched.
      expect(await repos.recipes.get('r1')).toBeNull();
      expect(await repos.recipes.get('r2')).toBeNull();
      expect(await repos.recipes.get('r3')).not.toBeNull();
    });

    it('Cancel resets the checkbox and dismisses without deleting', async () => {
      const { repos, onClose } = renderEditor({
        routines: [sampleRoutine()],
        recipes: [
          { id: 'r1', name: 'Only', routineId: 'bev-1', overrides: {} },
        ],
      });
      await waitFor(() => screen.getByTestId('delete-routine-button'));
      fireEvent.click(screen.getByTestId('delete-routine-button'));
      await waitFor(() => screen.getByTestId('delete-blocked'));

      fireEvent.click(screen.getByTestId('cascade-ack-checkbox'));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      // Reopen — checkbox is reset to unchecked.
      fireEvent.click(screen.getByTestId('delete-routine-button'));
      const ack = (await waitFor(() =>
        screen.getByTestId('cascade-ack-checkbox'),
      )) as HTMLInputElement;
      expect(ack.checked).toBe(false);

      expect(await repos.routines.get('bev-1')).not.toBeNull();
      expect(await repos.recipes.get('r1')).not.toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('uses singular "Recipe uses" when exactly one references', async () => {
      renderEditor({
        routines: [sampleRoutine()],
        recipes: [
          { id: 'r1', name: 'Only', routineId: 'bev-1', overrides: {} },
        ],
      });
      await waitFor(() => screen.getByTestId('delete-routine-button'));
      fireEvent.click(screen.getByTestId('delete-routine-button'));
      const blocked = await waitFor(() =>
        screen.getByTestId('delete-blocked'),
      );
      expect(blocked).toHaveTextContent(/1 Recipe uses/i);
      expect(blocked).toHaveTextContent(/Also delete this Recipe/i);
    });
  });
});
