import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { CleaningRunSection } from './CleaningRunSection';
import { WithRepositories } from '../../test/repositories';
import { LocalCleaningRepository } from '../../repositories';
import { MemoryStorage } from '../../test/memoryStorage';
import type { Cleaning } from '../../domain';

const seedRepo = (items: Cleaning[]): LocalCleaningRepository => {
  const s = new MemoryStorage();
  s.setItem('starter-skin.cleanings.v4', JSON.stringify(items));
  s.setItem('starter-skin.cleanings.seeded.v4', '1');
  return new LocalCleaningRepository(s);
};

describe('CleaningRunSection', () => {
  it('lists every cleaning, including hidden ones', async () => {
    const repo = seedRepo([
      {
        id: 'c1',
        name: 'Daily',
        operation: { kind: 'clean', steps: [{ id: 's1', type: 'coffeeSide' }] },
      },
      {
        id: 'c2',
        name: 'Descale',
        operation: { kind: 'descale', withChemical: true },
        hidden: true,
      },
    ]);
    render(() => (
      <WithRepositories cleanings={repo}>
        <CleaningRunSection />
      </WithRepositories>
    ));
    await waitFor(() => screen.getByTestId('run-cleanings-list'));
    expect(screen.getByTestId('run-cleaning-row-c1')).toHaveTextContent('Daily');
    // Hidden from Home, but still listed (and runnable) here.
    expect(screen.getByTestId('run-cleaning-row-c2')).toHaveTextContent('Descale');
  });

  it('disables Run when no onRun handler is wired', async () => {
    const repo = seedRepo([{ id: 'c1', name: 'Daily', operation: { kind: 'clean', steps: [{ id: 's1', type: 'flush' }] } }]);
    render(() => (
      <WithRepositories cleanings={repo}>
        <CleaningRunSection />
      </WithRepositories>
    ));
    await waitFor(() => screen.getByTestId('run-cleaning-c1'));
    expect(screen.getByTestId('run-cleaning-c1')).toBeDisabled();
  });

  it('calls onRun with the cleaning when Run is pressed', async () => {
    const repo = seedRepo([{ id: 'c1', name: 'Daily', operation: { kind: 'clean', steps: [{ id: 's1', type: 'flush' }] } }]);
    const onRun = vi.fn();
    render(() => (
      <WithRepositories cleanings={repo}>
        <CleaningRunSection onRun={onRun} />
      </WithRepositories>
    ));
    fireEvent.click(await waitFor(() => screen.getByTestId('run-cleaning-c1')));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun.mock.calls[0][0]).toMatchObject({ id: 'c1' });
  });

  it('offers Dismiss only while due, and acknowledges without running', async () => {
    const repo = seedRepo([
      {
        id: 'c1',
        name: 'Daily',
        operation: { kind: 'clean', steps: [{ id: 's1', type: 'flush' }] },
        // anchored 2 days ago, never done → an occurrence has passed → due
        reminder: {
          every: 1,
          unit: 'day',
          atTime: '08:00',
          anchor: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        },
      },
    ]);
    render(() => (
      <WithRepositories cleanings={repo}>
        <CleaningRunSection onRun={vi.fn()} />
      </WithRepositories>
    ));
    fireEvent.click(await waitFor(() => screen.getByTestId('dismiss-cleaning-c1')));
    await waitFor(async () =>
      expect((await repo.get('c1'))?.lastDoneAt).toBeTruthy(),
    );
  });

  it('hides Dismiss when the cleaning is not due', async () => {
    const repo = seedRepo([
      { id: 'c1', name: 'Daily', operation: { kind: 'clean', steps: [{ id: 's1', type: 'flush' }] } },
    ]);
    render(() => (
      <WithRepositories cleanings={repo}>
        <CleaningRunSection onRun={vi.fn()} />
      </WithRepositories>
    ));
    await waitFor(() => screen.getByTestId('run-cleaning-c1'));
    expect(screen.queryByTestId('dismiss-cleaning-c1')).not.toBeInTheDocument();
  });
});
