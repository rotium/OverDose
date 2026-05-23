import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@solidjs/testing-library';
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
    beverageStep('bean-selection', {}),
    beverageStep('brew', { targetYieldGrams: 36 }),
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
  it('renders one row per visible beverage with name + step count', async () => {
    await setupWith([
      seedBeverage('a', 'Espresso'),
      seedBeverage('b', 'Cappuccino'),
    ]);
    await waitFor(() => screen.getByTestId('beverages-list'));
    expect(screen.getByTestId('beverage-row-a')).toHaveTextContent('Espresso');
    expect(screen.getByTestId('beverage-row-b')).toHaveTextContent('Cappuccino');
    // Both seeds have 2 steps.
    expect(screen.getByTestId('beverage-row-a')).toHaveTextContent('2 steps');
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

  it('singularises "step" when a beverage has exactly one step', async () => {
    await setupWith([
      {
        id: 'one-step',
        name: 'Hot water',
        steps: [beverageStep('water', { volumeMl: 200 })],
      },
    ]);
    await waitFor(() =>
      expect(screen.getByTestId('beverage-row-one-step')).toHaveTextContent('1 step'),
    );
  });
});
