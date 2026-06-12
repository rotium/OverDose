import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { CleaningsSection } from './CleaningsSection';
import { WithRepositories } from '../../../../test/repositories';
import { LocalCleaningRepository } from '../../../../repositories';
import { MemoryStorage } from '../../../../test/memoryStorage';
import type { Cleaning } from '../../../../domain';

const seedRepo = (items: Cleaning[]): LocalCleaningRepository => {
  const s = new MemoryStorage();
  s.setItem('starter-skin.cleanings.v4', JSON.stringify(items));
  s.setItem('starter-skin.cleanings.seeded.v4', '1');
  return new LocalCleaningRepository(s);
};

const renderSection = (repo: LocalCleaningRepository) =>
  render(() => (
    <WithRepositories cleanings={repo}>
      <CleaningsSection />
    </WithRepositories>
  ));

describe('CleaningsSection', () => {
  it('renders a row per cleaning with name + operation summary', async () => {
    const repo = seedRepo([
      {
        id: 'c1',
        name: 'Daily Rinse',
        operation: {
          kind: 'clean',
          steps: [{ id: 's1', type: 'coffeeSide' }, { id: 's2', type: 'flush' }],
        },
      },
      { id: 'c2', name: 'Descale', operation: { kind: 'descale', withChemical: true } },
    ]);
    renderSection(repo);
    await waitFor(() => screen.getByTestId('cleanings-list'));
    expect(screen.getByTestId('cleaning-row-c1')).toHaveTextContent('Daily Rinse');
    expect(screen.getByTestId('cleaning-row-c1')).toHaveTextContent('Group head · Flush');
    expect(screen.getByTestId('cleaning-row-c2')).toHaveTextContent(
      'Citric acid · internals + steam',
    );
  });

  it('shows a due badge for an overdue cleaning', async () => {
    const repo = seedRepo([
      {
        id: 'c1',
        name: 'Weekly',
        operation: { kind: 'clean', steps: [{ id: 's1', type: 'coffeeSide' }] },
        // anchored 2 days ago, never done → an occurrence has passed → due
        reminder: {
          every: 1,
          unit: 'day',
          atTime: '08:00',
          anchor: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        },
      },
    ]);
    renderSection(repo);
    await waitFor(() => screen.getByTestId('cleaning-row-c1-due'));
    expect(screen.getByTestId('cleaning-row-c1-due')).toBeInTheDocument();
  });

  it('toggles hide-from-home', async () => {
    const repo = seedRepo([
      {
        id: 'c1',
        name: 'Daily',
        operation: { kind: 'clean', steps: [{ id: 's1', type: 'flush' }] },
      },
    ]);
    renderSection(repo);
    const toggle = await waitFor(() =>
      screen.getByTestId('cleaning-row-c1-toggle-hidden'),
    );
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(screen.getByTestId('cleaning-row-c1-toggle-hidden')).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    expect((await repo.get('c1'))?.hidden).toBe(true);
  });

  it('creates a cleaning and opens its editor', async () => {
    const repo = seedRepo([]);
    renderSection(repo);
    fireEvent.click(await waitFor(() => screen.getByTestId('open-new-cleaning')));
    fireEvent.input(screen.getByTestId('new-cleaning-name'), {
      target: { value: 'My Descale' },
    });
    fireEvent.change(screen.getByTestId('new-cleaning-kind'), {
      target: { value: 'descale' },
    });
    fireEvent.submit(screen.getByTestId('new-cleaning-form'));
    await waitFor(() => screen.getByTestId('cleaning-editor'));
    await waitFor(() =>
      expect(screen.getByTestId('cleaning-name-input')).toHaveValue('My Descale'),
    );
    expect((await repo.list())).toHaveLength(1);
  });
});
