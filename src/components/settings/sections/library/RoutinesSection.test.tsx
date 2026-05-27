import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { RoutinesSection } from './RoutinesSection';
import { WithRepositories } from '../../../../test/repositories';
import {
  LocalRoutineRepository,
  LocalRecipeRepository,
} from '../../../../repositories';
import { MemoryStorage } from '../../../../test/memoryStorage';
import { routineStep } from '../../../../domain';
import type { Routine } from '../../../../domain';

const seedRoutine = (id: string, name: string, hidden = false): Routine => ({
  id,
  name,
  hidden,
  steps: [
    routineStep('brew', {}),
    routineStep('steam', {}),
  ],
});

const setupWith = async (routines: Routine[]) => {
  const storage = new MemoryStorage();
  // Pre-seed storage so seedIfFirstRun is satisfied without falling back to
  // the bundled SEED_ROUTINES.
  storage.setItem('starter-skin.routines.v1', JSON.stringify(routines));
  storage.setItem('starter-skin.routines.seeded.v1', '1');
  const repo = new LocalRoutineRepository(storage);
  const recipes = new LocalRecipeRepository(new MemoryStorage());
  render(() => (
    <WithRepositories routines={repo} recipes={recipes}>
      <RoutinesSection />
    </WithRepositories>
  ));
  await waitFor(() => screen.getByRole('heading', { name: 'Routines' }));
};

describe('RoutinesSection', () => {
  it('renders one row per visible routine with name + step sequence hint', async () => {
    await setupWith([
      seedRoutine('a', 'Espresso'),
      seedRoutine('b', 'Cappuccino'),
    ]);
    await waitFor(() => screen.getByTestId('routines-list'));
    expect(screen.getByTestId('routine-row-a')).toHaveTextContent('Espresso');
    expect(screen.getByTestId('routine-row-b')).toHaveTextContent('Cappuccino');
    // Both seeds use [brew, steam].
    expect(screen.getByTestId('routine-row-a-sequence')).toHaveTextContent(
      'Brew → Steam',
    );
  });

  it('hides routines with hidden: true (uses listVisible)', async () => {
    await setupWith([
      seedRoutine('visible', 'Visible'),
      seedRoutine('hidden', 'Hidden', true),
    ]);
    await waitFor(() => screen.getByTestId('routine-row-visible'));
    expect(screen.queryByTestId('routine-row-hidden')).not.toBeInTheDocument();
  });

  it('shows an empty-state message when there are no visible routines', async () => {
    await setupWith([]);
    await waitFor(() => screen.getByText(/no routines yet/i));
  });

  it('renders the single step type when a routine has exactly one step', async () => {
    await setupWith([
      {
        id: 'one-step',
        name: 'Hot water',
        steps: [routineStep('water', {})],
      },
    ]);
    await waitFor(() =>
      expect(
        screen.getByTestId('routine-row-one-step-sequence'),
      ).toHaveTextContent(/^Water$/),
    );
  });

  it('shows "(no steps yet)" when the routine is empty', async () => {
    await setupWith([
      { id: 'empty', name: 'Blank', steps: [] },
    ]);
    await waitFor(() =>
      expect(
        screen.getByTestId('routine-row-empty-sequence'),
      ).toHaveTextContent(/no steps yet/i),
    );
  });

  describe('create new routine', () => {
    it('reveals an inline name form when the + button is clicked', async () => {
      await setupWith([]);
      await waitFor(() => screen.getByTestId('open-new-routine'));

      // Form is not visible until the button is clicked.
      expect(screen.queryByTestId('new-routine-form')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('open-new-routine'));
      expect(screen.getByTestId('new-routine-form')).toBeInTheDocument();
      // + New button is hidden while the form is open.
      expect(screen.queryByTestId('open-new-routine')).not.toBeInTheDocument();
    });

    it('Create button is disabled until the name has non-whitespace content', async () => {
      await setupWith([]);
      fireEvent.click(await waitFor(() => screen.getByTestId('open-new-routine')));

      const submit = screen.getByTestId('confirm-new-routine') as HTMLButtonElement;
      expect(submit.disabled).toBe(true);

      const input = screen.getByTestId('new-routine-name') as HTMLInputElement;
      input.value = '   ';
      fireEvent.input(input);
      expect(submit.disabled).toBe(true);

      input.value = 'Macchiato';
      fireEvent.input(input);
      expect(submit.disabled).toBe(false);
    });

    it('submitting persists the new routine and opens the editor on it', async () => {
      await setupWith([]);
      fireEvent.click(await waitFor(() => screen.getByTestId('open-new-routine')));

      const input = screen.getByTestId('new-routine-name') as HTMLInputElement;
      input.value = 'Macchiato';
      fireEvent.input(input);
      fireEvent.click(screen.getByTestId('confirm-new-routine'));

      // Editor side-sheet opens for the new routine.
      await waitFor(() => screen.getByTestId('routine-editor'));
      expect(
        (screen.getByTestId('routine-name-input') as HTMLInputElement).value,
      ).toBe('Macchiato');

      // Form is closed again after submit.
      expect(screen.queryByTestId('new-routine-form')).not.toBeInTheDocument();
    });

    it('Cancel collapses the form without creating anything', async () => {
      await setupWith([]);
      fireEvent.click(await waitFor(() => screen.getByTestId('open-new-routine')));

      const input = screen.getByTestId('new-routine-name') as HTMLInputElement;
      input.value = 'Discarded';
      fireEvent.input(input);
      fireEvent.click(screen.getByTestId('cancel-new-routine'));

      expect(screen.queryByTestId('new-routine-form')).not.toBeInTheDocument();
      // Empty-state still shows; nothing was created.
      expect(screen.getByText(/no routines yet/i)).toBeInTheDocument();
    });
  });

  describe('list ↔ side-sheet editor', () => {
    it('clicking a row opens the side-sheet editor over the list', async () => {
      await setupWith([seedRoutine('a', 'Espresso')]);
      await waitFor(() => screen.getByTestId('routine-row-a'));
      fireEvent.click(screen.getByTestId('routine-row-a'));
      await waitFor(() => screen.getByTestId('routine-editor'));
      // Sheet + backdrop appear; list stays in the DOM behind the backdrop.
      expect(screen.getByTestId('side-sheet')).toHaveAttribute('data-state', 'open');
      expect(screen.getByTestId('side-sheet-backdrop')).toBeInTheDocument();
      expect(screen.getByTestId('routines-list')).toBeInTheDocument();
    });

    it('sheet close (X) dismisses the editor with a slide-out, then unmounts', async () => {
      await setupWith([seedRoutine('a', 'Espresso')]);
      await waitFor(() => screen.getByTestId('routine-row-a'));
      fireEvent.click(screen.getByTestId('routine-row-a'));
      await waitFor(() => screen.getByTestId('routine-editor'));

      fireEvent.click(screen.getByTestId('side-sheet-close'));
      // Slide-out state is flipped immediately.
      expect(screen.getByTestId('side-sheet')).toHaveAttribute('data-state', 'closing');
      // Then the sheet unmounts after the animation completes.
      await waitFor(
        () => expect(screen.queryByTestId('routine-editor')).not.toBeInTheDocument(),
        { timeout: 600 },
      );
    });

    it('clicking the backdrop dismisses the sheet', async () => {
      await setupWith([seedRoutine('a', 'Espresso')]);
      await waitFor(() => screen.getByTestId('routine-row-a'));
      fireEvent.click(screen.getByTestId('routine-row-a'));
      await waitFor(() => screen.getByTestId('routine-editor'));

      fireEvent.click(screen.getByTestId('side-sheet-backdrop'));
      await waitFor(
        () => expect(screen.queryByTestId('routine-editor')).not.toBeInTheDocument(),
        { timeout: 600 },
      );
    });

    it('Escape key dismisses the sheet', async () => {
      await setupWith([seedRoutine('a', 'Espresso')]);
      await waitFor(() => screen.getByTestId('routine-row-a'));
      fireEvent.click(screen.getByTestId('routine-row-a'));
      await waitFor(() => screen.getByTestId('routine-editor'));

      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(
        () => expect(screen.queryByTestId('routine-editor')).not.toBeInTheDocument(),
        { timeout: 600 },
      );
    });
  });
});
