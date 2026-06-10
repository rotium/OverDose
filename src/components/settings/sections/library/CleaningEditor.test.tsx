import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { CleaningEditor } from './CleaningEditor';
import { WithRepositories } from '../../../../test/repositories';
import { LocalCleaningRepository } from '../../../../repositories';
import { MemoryStorage } from '../../../../test/memoryStorage';
import type { Cleaning } from '../../../../domain';

const seedRepo = (items: Cleaning[]): LocalCleaningRepository => {
  const s = new MemoryStorage();
  s.setItem('starter-skin.cleanings.v2', JSON.stringify(items));
  s.setItem('starter-skin.cleanings.seeded.v2', '1');
  return new LocalCleaningRepository(s);
};

const renderEditor = (repo: LocalCleaningRepository, onClose = vi.fn()) => {
  render(() => (
    <WithRepositories cleanings={repo}>
      <CleaningEditor
        cleaningId="c1"
        onClose={onClose}
        debounceMs={0}
        loadProfiles={async () => []}
      />
    </WithRepositories>
  ));
  return { onClose };
};

const weekly = (): Cleaning => ({
  id: 'c1',
  name: 'Weekly',
  operation: {
    kind: 'clean',
    steps: [
      { id: 's1', type: 'coffeeSide', withChemical: true },
      { id: 's2', type: 'flush' },
    ],
  },
});

describe('CleaningEditor — Clean', () => {
  it('renders the Clean subtitle and its steps', async () => {
    renderEditor(seedRepo([weekly()]));
    await waitFor(() => screen.getByTestId('cleaning-editor'));
    expect(screen.getByTestId('cleaning-operation')).toHaveTextContent('Clean');
    expect(screen.getByTestId('cleaning-step-s1')).toHaveTextContent('Group head');
    expect(screen.getByTestId('cleaning-step-s2')).toHaveTextContent('Flush');
  });

  it('adds a step', async () => {
    const repo = seedRepo([
      { id: 'c1', name: 'X', operation: { kind: 'clean', steps: [] } },
    ]);
    renderEditor(repo);
    fireEvent.click(await waitFor(() => screen.getByTestId('open-add-step')));
    fireEvent.click(screen.getByTestId('add-step-flush'));
    await waitFor(async () => {
      const c = await repo.get('c1');
      expect(c?.operation.kind === 'clean' && c.operation.steps).toHaveLength(1);
    });
  });

  it('toggles a coffee-side step chemical and persists', async () => {
    const repo = seedRepo([weekly()]);
    renderEditor(repo);
    const cb = (await waitFor(() =>
      screen.getByTestId('step-chemical-s1'),
    )) as HTMLInputElement;
    expect(cb.checked).toBe(true);
    fireEvent.click(cb);
    await waitFor(async () => {
      const c = await repo.get('c1');
      const s = c?.operation.kind === 'clean' ? c.operation.steps[0] : undefined;
      expect(s).toMatchObject({ type: 'coffeeSide', withChemical: false });
    });
  });

  it('removes a step', async () => {
    const repo = seedRepo([weekly()]);
    renderEditor(repo);
    fireEvent.click(await waitFor(() => screen.getByTestId('step-remove-s2')));
    await waitFor(async () => {
      const c = await repo.get('c1');
      expect(c?.operation.kind === 'clean' && c.operation.steps).toHaveLength(1);
    });
  });

  it('edits a flush step duration', async () => {
    const repo = seedRepo([
      {
        id: 'c1',
        name: 'X',
        operation: { kind: 'clean', steps: [{ id: 's1', type: 'flush', seconds: 20 }] },
      },
    ]);
    renderEditor(repo);
    const field = (await waitFor(() =>
      screen.getByTestId('step-seconds-s1'),
    )) as HTMLInputElement;
    fireEvent.input(field, { target: { value: '8' } });
    fireEvent.blur(field);
    await waitFor(async () => {
      const c = await repo.get('c1');
      const s = c?.operation.kind === 'clean' ? c.operation.steps[0] : undefined;
      expect(s).toMatchObject({ type: 'flush', seconds: 8 });
    });
  });

  it('reorders steps with the down arrow', async () => {
    const repo = seedRepo([weekly()]);
    renderEditor(repo);
    fireEvent.click(await waitFor(() => screen.getByTestId('step-down-s1')));
    await waitFor(async () => {
      const c = await repo.get('c1');
      const ids =
        c?.operation.kind === 'clean' ? c.operation.steps.map((s) => s.id) : [];
      expect(ids).toEqual(['s2', 's1']);
    });
  });
});

describe('CleaningEditor — Descale', () => {
  const descale = (): Cleaning => ({
    id: 'c1',
    name: 'Descale',
    operation: { kind: 'descale', withChemical: true },
  });

  it('shows the citric toggle + prep and no step list', async () => {
    renderEditor(seedRepo([descale()]));
    await waitFor(() => screen.getByTestId('cleaning-editor'));
    expect(screen.getByTestId('cleaning-operation')).toHaveTextContent('Descale');
    expect(screen.getByTestId('descale-prep')).toBeInTheDocument();
    expect(screen.queryByTestId('cleaning-steps')).toBeNull();
    expect(
      (screen.getByTestId('descale-with-chemical') as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('persists the citric toggle', async () => {
    const repo = seedRepo([descale()]);
    renderEditor(repo);
    fireEvent.click(await waitFor(() => screen.getByTestId('descale-with-chemical')));
    await waitFor(async () => {
      const c = await repo.get('c1');
      expect(c?.operation).toMatchObject({ kind: 'descale', withChemical: false });
    });
  });
});

describe('CleaningEditor — shared', () => {
  it('Reset reminder stamps lastDoneAt', async () => {
    const repo = seedRepo([weekly()]);
    renderEditor(repo);
    fireEvent.click(await waitFor(() => screen.getByTestId('cleaning-reset-reminder')));
    await waitFor(async () =>
      expect((await repo.get('c1'))?.lastDoneAt).toBeTruthy(),
    );
  });

  it('deletes after confirm and calls onClose', async () => {
    const repo = seedRepo([weekly()]);
    const { onClose } = renderEditor(repo);
    fireEvent.click(await waitFor(() => screen.getByTestId('delete-cleaning-button')));
    fireEvent.click(screen.getByTestId('confirm-delete-cleaning-button'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await repo.get('c1')).toBeNull();
  });
});
