import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { BeveragesSection } from './BeveragesSection';
import { WithRepositories } from '../../../../test/repositories';
import {
  LocalBeverageRepository,
  LocalRecipeRepository,
} from '../../../../repositories';
import { MemoryStorage } from '../../../../test/memoryStorage';
import { beverageStep } from '../../../../domain';
import type { Beverage } from '../../../../domain';

const seedBeverage = (id: string, name: string, hidden = false): Beverage => ({
  id,
  name,
  hidden,
  steps: [
    beverageStep('brew', {}),
    beverageStep('steam', {}),
  ],
});

const setupWith = async (beverages: Beverage[]) => {
  const storage = new MemoryStorage();
  // Pre-seed storage so seedIfFirstRun is satisfied without falling back to
  // the bundled SEED_BEVERAGES.
  storage.setItem('starter-skin.beverages.v1', JSON.stringify(beverages));
  storage.setItem('starter-skin.beverages.seeded.v1', '1');
  const repo = new LocalBeverageRepository(storage);
  const recipes = new LocalRecipeRepository(new MemoryStorage());
  render(() => (
    <WithRepositories beverages={repo} recipes={recipes}>
      <BeveragesSection />
    </WithRepositories>
  ));
  await waitFor(() => screen.getByRole('heading', { name: 'Beverages' }));
};

describe('BeveragesSection', () => {
  it('renders one row per visible beverage with name + step sequence hint', async () => {
    await setupWith([
      seedBeverage('a', 'Espresso'),
      seedBeverage('b', 'Cappuccino'),
    ]);
    await waitFor(() => screen.getByTestId('beverages-list'));
    expect(screen.getByTestId('beverage-row-a')).toHaveTextContent('Espresso');
    expect(screen.getByTestId('beverage-row-b')).toHaveTextContent('Cappuccino');
    // Both seeds use [brew, steam].
    expect(screen.getByTestId('beverage-row-a-sequence')).toHaveTextContent(
      'Brew → Steam',
    );
  });

  it('hides beverages with hidden: true (uses listVisible)', async () => {
    await setupWith([
      seedBeverage('visible', 'Visible'),
      seedBeverage('hidden', 'Hidden', true),
    ]);
    await waitFor(() => screen.getByTestId('beverage-row-visible'));
    expect(screen.queryByTestId('beverage-row-hidden')).not.toBeInTheDocument();
  });

  it('shows an empty-state message when there are no visible beverages', async () => {
    await setupWith([]);
    await waitFor(() => screen.getByText(/no beverages yet/i));
  });

  it('renders the single step type when a beverage has exactly one step', async () => {
    await setupWith([
      {
        id: 'one-step',
        name: 'Hot water',
        steps: [beverageStep('water', {})],
      },
    ]);
    await waitFor(() =>
      expect(
        screen.getByTestId('beverage-row-one-step-sequence'),
      ).toHaveTextContent(/^Water$/),
    );
  });

  it('shows "(no steps yet)" when the beverage is empty', async () => {
    await setupWith([
      { id: 'empty', name: 'Blank', steps: [] },
    ]);
    await waitFor(() =>
      expect(
        screen.getByTestId('beverage-row-empty-sequence'),
      ).toHaveTextContent(/no steps yet/i),
    );
  });

  describe('create new beverage', () => {
    it('reveals an inline name form when the + button is clicked', async () => {
      await setupWith([]);
      await waitFor(() => screen.getByTestId('open-new-beverage'));

      // Form is not visible until the button is clicked.
      expect(screen.queryByTestId('new-beverage-form')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('open-new-beverage'));
      expect(screen.getByTestId('new-beverage-form')).toBeInTheDocument();
      // + New button is hidden while the form is open.
      expect(screen.queryByTestId('open-new-beverage')).not.toBeInTheDocument();
    });

    it('Create button is disabled until the name has non-whitespace content', async () => {
      await setupWith([]);
      fireEvent.click(await waitFor(() => screen.getByTestId('open-new-beverage')));

      const submit = screen.getByTestId('confirm-new-beverage') as HTMLButtonElement;
      expect(submit.disabled).toBe(true);

      const input = screen.getByTestId('new-beverage-name') as HTMLInputElement;
      input.value = '   ';
      fireEvent.input(input);
      expect(submit.disabled).toBe(true);

      input.value = 'Macchiato';
      fireEvent.input(input);
      expect(submit.disabled).toBe(false);
    });

    it('submitting persists the new beverage and opens the editor on it', async () => {
      await setupWith([]);
      fireEvent.click(await waitFor(() => screen.getByTestId('open-new-beverage')));

      const input = screen.getByTestId('new-beverage-name') as HTMLInputElement;
      input.value = 'Macchiato';
      fireEvent.input(input);
      fireEvent.click(screen.getByTestId('confirm-new-beverage'));

      // Editor side-sheet opens for the new beverage.
      await waitFor(() => screen.getByTestId('beverage-editor'));
      expect(
        (screen.getByTestId('beverage-name-input') as HTMLInputElement).value,
      ).toBe('Macchiato');

      // Form is closed again after submit.
      expect(screen.queryByTestId('new-beverage-form')).not.toBeInTheDocument();
    });

    it('Cancel collapses the form without creating anything', async () => {
      await setupWith([]);
      fireEvent.click(await waitFor(() => screen.getByTestId('open-new-beverage')));

      const input = screen.getByTestId('new-beverage-name') as HTMLInputElement;
      input.value = 'Discarded';
      fireEvent.input(input);
      fireEvent.click(screen.getByTestId('cancel-new-beverage'));

      expect(screen.queryByTestId('new-beverage-form')).not.toBeInTheDocument();
      // Empty-state still shows; nothing was created.
      expect(screen.getByText(/no beverages yet/i)).toBeInTheDocument();
    });
  });

  describe('list ↔ side-sheet editor', () => {
    it('clicking a row opens the side-sheet editor over the list', async () => {
      await setupWith([seedBeverage('a', 'Espresso')]);
      await waitFor(() => screen.getByTestId('beverage-row-a'));
      fireEvent.click(screen.getByTestId('beverage-row-a'));
      await waitFor(() => screen.getByTestId('beverage-editor'));
      // Sheet + backdrop appear; list stays in the DOM behind the backdrop.
      expect(screen.getByTestId('side-sheet')).toHaveAttribute('data-state', 'open');
      expect(screen.getByTestId('side-sheet-backdrop')).toBeInTheDocument();
      expect(screen.getByTestId('beverages-list')).toBeInTheDocument();
    });

    it('sheet close (X) dismisses the editor with a slide-out, then unmounts', async () => {
      await setupWith([seedBeverage('a', 'Espresso')]);
      await waitFor(() => screen.getByTestId('beverage-row-a'));
      fireEvent.click(screen.getByTestId('beverage-row-a'));
      await waitFor(() => screen.getByTestId('beverage-editor'));

      fireEvent.click(screen.getByTestId('side-sheet-close'));
      // Slide-out state is flipped immediately.
      expect(screen.getByTestId('side-sheet')).toHaveAttribute('data-state', 'closing');
      // Then the sheet unmounts after the animation completes.
      await waitFor(
        () => expect(screen.queryByTestId('beverage-editor')).not.toBeInTheDocument(),
        { timeout: 600 },
      );
    });

    it('clicking the backdrop dismisses the sheet', async () => {
      await setupWith([seedBeverage('a', 'Espresso')]);
      await waitFor(() => screen.getByTestId('beverage-row-a'));
      fireEvent.click(screen.getByTestId('beverage-row-a'));
      await waitFor(() => screen.getByTestId('beverage-editor'));

      fireEvent.click(screen.getByTestId('side-sheet-backdrop'));
      await waitFor(
        () => expect(screen.queryByTestId('beverage-editor')).not.toBeInTheDocument(),
        { timeout: 600 },
      );
    });

    it('Escape key dismisses the sheet', async () => {
      await setupWith([seedBeverage('a', 'Espresso')]);
      await waitFor(() => screen.getByTestId('beverage-row-a'));
      fireEvent.click(screen.getByTestId('beverage-row-a'));
      await waitFor(() => screen.getByTestId('beverage-editor'));

      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(
        () => expect(screen.queryByTestId('beverage-editor')).not.toBeInTheDocument(),
        { timeout: 600 },
      );
    });
  });
});
