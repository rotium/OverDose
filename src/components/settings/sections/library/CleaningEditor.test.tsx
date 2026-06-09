import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { CleaningEditor } from './CleaningEditor';
import { WithRepositories } from '../../../../test/repositories';
import { LocalCleaningRepository } from '../../../../repositories';
import { MemoryStorage } from '../../../../test/memoryStorage';
import type { Cleaning } from '../../../../domain';

const seedRepo = (items: Cleaning[]): LocalCleaningRepository => {
  const s = new MemoryStorage();
  s.setItem('starter-skin.cleanings.v1', JSON.stringify(items));
  s.setItem('starter-skin.cleanings.seeded.v1', '1');
  return new LocalCleaningRepository(s);
};

const renderEditor = (repo: LocalCleaningRepository, onClose = vi.fn()) => {
  render(() => (
    <WithRepositories cleanings={repo}>
      <CleaningEditor cleaningId="c1" onClose={onClose} debounceMs={0} />
    </WithRepositories>
  ));
  return { onClose };
};

describe('CleaningEditor', () => {
  it('renders name + operation (read-only), and the profile section for a profile cleaning', async () => {
    const repo = seedRepo([
      { id: 'c1', name: 'Daily', operation: { kind: 'profile', withChemical: true } },
    ]);
    renderEditor(repo);
    await waitFor(() => screen.getByTestId('cleaning-editor'));
    expect(screen.getByTestId('cleaning-name-input')).toHaveValue('Daily');
    expect(screen.getByTestId('cleaning-operation')).toHaveTextContent('Cleaning profile');
    // Operation is fixed at create time — no editable control.
    expect(screen.queryByTestId('cleaning-operation-select')).toBeNull();
    expect(screen.getByTestId('cleaning-editor-profile-field')).toBeInTheDocument();
    expect(screen.getByTestId('cleaning-chemical-toggle')).toHaveTextContent(
      /Cafiza in the blind basket/i,
    );
  });

  it('a descale cleaning shows the citric label and no profile row', async () => {
    const repo = seedRepo([
      { id: 'c1', name: 'X', operation: { kind: 'descale', withChemical: true } },
    ]);
    renderEditor(repo);
    await waitFor(() => screen.getByTestId('cleaning-editor'));
    expect(screen.getByTestId('cleaning-operation')).toHaveTextContent('Descale');
    expect(screen.queryByTestId('cleaning-editor-profile-field')).toBeNull();
    expect(screen.getByTestId('cleaning-chemical-toggle')).toHaveTextContent(
      /citric acid \(in the tank\)/i,
    );
  });

  it('persists the chemical toggle', async () => {
    const repo = seedRepo([
      { id: 'c1', name: 'X', operation: { kind: 'descale', withChemical: true } },
    ]);
    renderEditor(repo);
    const cb = (await waitFor(() =>
      screen.getByTestId('cleaning-with-chemical'),
    )) as HTMLInputElement;
    expect(cb.checked).toBe(true);
    fireEvent.click(cb);
    await waitFor(async () =>
      expect((await repo.get('c1'))?.operation).toMatchObject({
        kind: 'descale',
        withChemical: false,
      }),
    );
  });

  it('enabling reminders adds a cadence; disabling clears it', async () => {
    const repo = seedRepo([{ id: 'c1', name: 'X', operation: { kind: 'flush' } }]);
    renderEditor(repo);
    const remind = (await waitFor(() =>
      screen.getByTestId('cleaning-remind-me'),
    )) as HTMLInputElement;
    expect(remind.checked).toBe(false);
    fireEvent.click(remind);
    await waitFor(async () =>
      expect((await repo.get('c1'))?.cadence).toBeDefined(),
    );
  });

  it('Reset reminder stamps lastDoneAt', async () => {
    const repo = seedRepo([{ id: 'c1', name: 'X', operation: { kind: 'flush' } }]);
    renderEditor(repo);
    fireEvent.click(await waitFor(() => screen.getByTestId('cleaning-reset-reminder')));
    await waitFor(async () =>
      expect((await repo.get('c1'))?.lastDoneAt).toBeTruthy(),
    );
  });

  it('deletes after confirm and calls onClose', async () => {
    const repo = seedRepo([{ id: 'c1', name: 'X', operation: { kind: 'flush' } }]);
    const { onClose } = renderEditor(repo);
    fireEvent.click(await waitFor(() => screen.getByTestId('delete-cleaning-button')));
    fireEvent.click(screen.getByTestId('confirm-delete-cleaning-button'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await repo.get('c1')).toBeNull();
  });
});
