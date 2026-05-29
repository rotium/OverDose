import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { PitcherEditor } from './PitcherEditor';
import { WithRepositories } from '../../../../test/repositories';
import { LocalPitcherRepository } from '../../../../repositories';
import { MemoryStorage } from '../../../../test/memoryStorage';
import type { Pitcher } from '../../../../domain';

const seedOne = (): { repo: LocalPitcherRepository; pitcher: Pitcher } => {
  const store = new MemoryStorage();
  store.setItem(
    'starter-skin.pitchers.v1',
    JSON.stringify([
      {
        id: 'p1',
        name: 'Small',
        capacityMl: 350,
        steamDurationSec: 30,
        steamTempC: 150,
        steamFlow: 0.8,
      },
    ]),
  );
  store.setItem('starter-skin.pitchers.seeded.v1', '1');
  const repo = new LocalPitcherRepository(store);
  return { repo, pitcher: { id: 'p1' } as Pitcher };
};

const renderEditor = (repo: LocalPitcherRepository, onClose = vi.fn()) => {
  render(() => (
    <WithRepositories pitchers={repo}>
      <PitcherEditor pitcherId="p1" onClose={onClose} debounceMs={0} />
    </WithRepositories>
  ));
  return { onClose };
};

describe('PitcherEditor', () => {
  it('renders the pitcher fields', async () => {
    const { repo } = seedOne();
    renderEditor(repo);
    await waitFor(() => screen.getByTestId('pitcher-editor'));
    expect(
      (screen.getByTestId('pitcher-name-input') as HTMLInputElement).value,
    ).toBe('Small');
    expect(
      (screen.getByTestId('pitcher-duration-input') as HTMLInputElement).value,
    ).toBe('30');
    expect(
      (screen.getByTestId('pitcher-flow-input') as HTMLInputElement).value,
    ).toBe('0.8');
  });

  it('persists an edited steam duration', async () => {
    const { repo } = seedOne();
    renderEditor(repo);
    const dur = (await waitFor(() =>
      screen.getByTestId('pitcher-duration-input'),
    )) as HTMLInputElement;
    dur.value = '45';
    fireEvent.input(dur);
    await waitFor(async () => {
      expect((await repo.get('p1'))?.steamDurationSec).toBe(45);
    });
  });

  it('deletes the pitcher and closes', async () => {
    const { repo } = seedOne();
    const { onClose } = renderEditor(repo);
    fireEvent.click(await waitFor(() => screen.getByTestId('delete-pitcher-button')));
    fireEvent.click(screen.getByTestId('confirm-delete-pitcher-button'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await repo.get('p1')).toBeNull();
  });
});
