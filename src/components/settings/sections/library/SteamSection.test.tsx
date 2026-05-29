import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { SteamSection } from './SteamSection';
import { WithRepositories } from '../../../../test/repositories';
import { LocalPitcherRepository } from '../../../../repositories';
import { MemoryStorage } from '../../../../test/memoryStorage';
import type { ShotSettingsSnapshot } from '../../../../snapshot';
import type { WsStream } from '../../../../streams';

const mkShotStream = (
  value: ShotSettingsSnapshot | null,
): WsStream<ShotSettingsSnapshot> => {
  const [latest] = createSignal<ShotSettingsSnapshot | null>(value);
  const [status] = createSignal<'open'>('open');
  return { latest, status };
};

const renderSection = (opts: {
  shotSettingsStream?: WsStream<ShotSettingsSnapshot>;
  loadMachineSettings?: () => Promise<{ steamFlow: number } | null>;
} = {}) => {
  const pitchers = new LocalPitcherRepository(new MemoryStorage());
  render(() => (
    <WithRepositories pitchers={pitchers}>
      <SteamSection
        shotSettingsStream={opts.shotSettingsStream}
        loadMachineSettings={opts.loadMachineSettings}
      />
    </WithRepositories>
  ));
  return { pitchers };
};

describe('SteamSection', () => {
  it('lists the seeded pitchers', async () => {
    renderSection();
    await waitFor(() => screen.getByTestId('pitchers-list'));
    expect(screen.getByTestId('pitcher-row-seed-pitcher-small')).toHaveTextContent(
      'Small',
    );
    expect(screen.getByTestId('pitcher-row-seed-pitcher-large')).toHaveTextContent(
      'Large',
    );
  });

  it('opens the editor when a pitcher row is clicked', async () => {
    renderSection();
    fireEvent.click(
      await waitFor(() => screen.getByTestId('pitcher-row-seed-pitcher-small')),
    );
    await waitFor(() => screen.getByTestId('pitcher-editor'));
    expect(
      (screen.getByTestId('pitcher-name-input') as HTMLInputElement).value,
    ).toBe('Small');
  });

  it('creates a new pitcher and opens its editor', async () => {
    const { pitchers } = renderSection();
    fireEvent.click(await waitFor(() => screen.getByTestId('open-new-pitcher')));
    const name = screen.getByTestId('new-pitcher-name') as HTMLInputElement;
    name.value = 'Travel mug';
    fireEvent.input(name);
    fireEvent.click(screen.getByTestId('confirm-new-pitcher'));
    await waitFor(() => screen.getByTestId('pitcher-editor'));
    const all = await pitchers.list();
    expect(all.some((p) => p.name === 'Travel mug')).toBe(true);
  });

  it('seeds a new pitcher\'s steam params from the machine settings', async () => {
    const { pitchers } = renderSection({
      shotSettingsStream: mkShotStream({
        steamSetting: 0,
        targetSteamTemp: 158,
        targetSteamDuration: 42,
        targetHotWaterTemp: 85,
        targetHotWaterVolume: 100,
        targetHotWaterDuration: 35,
        targetShotVolume: 36,
        groupTemp: 94,
      }),
      loadMachineSettings: () => Promise.resolve({ steamFlow: 1.4 }),
    });
    fireEvent.click(await waitFor(() => screen.getByTestId('open-new-pitcher')));
    const name = screen.getByTestId('new-pitcher-name') as HTMLInputElement;
    name.value = 'Latte jug';
    fireEvent.input(name);
    fireEvent.click(screen.getByTestId('confirm-new-pitcher'));
    await waitFor(() => screen.getByTestId('pitcher-editor'));
    const created = (await pitchers.list()).find((p) => p.name === 'Latte jug');
    expect(created).toMatchObject({
      steamDurationSec: 42,
      steamTempC: 158,
      steamFlow: 1.4,
    });
  });

  it('falls back to defaults when no machine settings are available', async () => {
    const { pitchers } = renderSection({
      loadMachineSettings: () => Promise.resolve(null),
    }); // no shotSettings stream, machineSettings null
    fireEvent.click(await waitFor(() => screen.getByTestId('open-new-pitcher')));
    const name = screen.getByTestId('new-pitcher-name') as HTMLInputElement;
    name.value = 'Fallback jug';
    fireEvent.input(name);
    fireEvent.click(screen.getByTestId('confirm-new-pitcher'));
    await waitFor(() => screen.getByTestId('pitcher-editor'));
    const created = (await pitchers.list()).find(
      (p) => p.name === 'Fallback jug',
    );
    expect(created).toMatchObject({
      steamDurationSec: 30,
      steamTempC: 150,
      steamFlow: 0.8,
    });
  });
});
