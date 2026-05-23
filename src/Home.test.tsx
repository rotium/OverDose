import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';

// Chart is not the subject under test here.
vi.mock('./components/ShotMiniChart', () => ({
  ShotMiniChart: () => <div data-testid="shot-mini-chart-stub" />,
}));

import { Home } from './Home';
import type { Workflow } from './domain';
import type { WorkflowRepository } from './repositories';
import type {
  MachineSnapshot,
  ScaleMessage,
  ShotSettingsSnapshot,
  WaterLevelsSnapshot,
} from './snapshot';
import type { WsStream } from './streams';
import type { GatewayShotRecord, GatewayShotSummary } from './api';

const sampleWorkflow: Workflow = {
  id: 'seed-espresso',
  name: 'Espresso',
  pipeline: { id: 'p', name: 'p', steps: [] },
};

const fakeRepo: WorkflowRepository = {
  list: async () => [sampleWorkflow],
  get: async () => sampleWorkflow,
  create: async (w) => w,
  update: async (w) => w,
  delete: async () => {},
};

const settings: ShotSettingsSnapshot = {
  steamSetting: 0,
  targetSteamTemp: 145,
  targetSteamDuration: 30,
  targetHotWaterTemp: 95,
  targetHotWaterVolume: 120,
  targetHotWaterDuration: 30,
  targetShotVolume: 36,
  groupTemp: 93,
};

const summary: GatewayShotSummary = {
  id: 'shot-1',
  timestamp: new Date().toISOString(),
  workflow: { name: 'Espresso' },
  annotations: { actualDoseWeight: 18, actualYield: 36 },
};
const fullRecord: GatewayShotRecord = { ...summary, measurements: [] };

interface Stubs {
  machineSnap?: MachineSnapshot | null;
  scaleMsg?: ScaleMessage | null;
  settings?: ShotSettingsSnapshot | null;
  water?: WaterLevelsSnapshot | null;
}

const buildHome = (overrides: Partial<{
  stubs: Stubs;
  onSleep: () => void;
  onWake: () => void;
  onMenu: () => void;
  onUpdate: (s: ShotSettingsSnapshot) => void;
  onSelect: (w: Workflow) => void;
  onSeeAll: () => void;
}> = {}) => {
  const stubs = overrides.stubs ?? {};

  const mkStream = <T,>(initial: T | null): WsStream<T> => {
    const [latest] = createSignal<T | null>(initial);
    const [status] = createSignal<'open'>('open');
    return { latest, status };
  };

  return (
    <Home
      workflowRepository={fakeRepo}
      machineStream={() => mkStream<MachineSnapshot>(stubs.machineSnap ?? null)}
      scaleStream={() => mkStream<ScaleMessage>(stubs.scaleMsg ?? null)}
      shotSettingsStream={() => mkStream<ShotSettingsSnapshot>(stubs.settings ?? null)}
      waterLevelsStream={() => mkStream<WaterLevelsSnapshot>(stubs.water ?? null)}
      fetchLatestShot={() => Promise.resolve(summary)}
      fetchShot={() => Promise.resolve(fullRecord)}
      onSleep={overrides.onSleep ?? vi.fn()}
      onWake={overrides.onWake ?? vi.fn()}
      onUpdateShotSettings={overrides.onUpdate ?? vi.fn()}
      onMenu={overrides.onMenu ?? vi.fn()}
      onSelectWorkflow={overrides.onSelect ?? vi.fn()}
      onSeeAllShots={overrides.onSeeAll ?? vi.fn()}
    />
  );
};

describe('Home', () => {
  it('composes Header, WorkflowPicker, StatusPanel, and LastShotCard', async () => {
    render(() => buildHome());
    // Header
    expect(screen.getByText('Decent.app')).toBeInTheDocument();
    // Picker
    await waitFor(() => screen.getByTestId('workflow-tile-seed-espresso'));
    // StatusPanel
    expect(screen.getByTestId('status-state')).toBeInTheDocument();
    // LastShotCard (chart is stubbed, so the stub element appearing proves
    // the card mounted and the full record fetch completed)
    await waitFor(() => screen.getByTestId('shot-mini-chart-stub'));
  });

  it('Sleep button invokes onSleep when machine is awake', () => {
    const onSleep = vi.fn();
    const onWake = vi.fn();
    render(() => buildHome({ onSleep, onWake }));
    fireEvent.click(screen.getByRole('button', { name: 'Sleep' }));
    expect(onSleep).toHaveBeenCalledTimes(1);
    expect(onWake).not.toHaveBeenCalled();
  });

  it('Sleep button flips to "Wake machine" and invokes onWake when machine state is sleeping', () => {
    const onSleep = vi.fn();
    const onWake = vi.fn();
    const sleepingSnap: MachineSnapshot = {
      timestamp: '2026-05-22T08:00:00Z',
      state: { state: 'sleeping', substate: 'idle' },
      flow: 0,
      pressure: 0,
      targetFlow: 0,
      targetPressure: 0,
      mixTemperature: 25,
      groupTemperature: 25,
      targetMixTemperature: 0,
      targetGroupTemperature: 0,
      profileFrame: 0,
      steamTemperature: 25,
    };
    render(() =>
      buildHome({ stubs: { machineSnap: sleepingSnap }, onSleep, onWake }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Wake machine' }));
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(onSleep).not.toHaveBeenCalled();
  });

  it('steam toggle composes the current settings with steamSetting flipped', () => {
    const onUpdate = vi.fn();
    render(() =>
      buildHome({
        stubs: { settings: { ...settings, steamSetting: 0 } },
        onUpdate,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Toggle steam heater' }));
    expect(onUpdate).toHaveBeenCalledWith({ ...settings, steamSetting: 1 });
  });

  it('does not call onUpdateShotSettings if no current settings are loaded', () => {
    const onUpdate = vi.fn();
    render(() => buildHome({ onUpdate }));
    // Steam button is disabled when settings === null
    expect(screen.getByRole('button', { name: 'Toggle steam heater' })).toBeDisabled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('tapping a Workflow tile calls onSelectWorkflow', async () => {
    const onSelect = vi.fn();
    render(() => buildHome({ onSelect }));
    await waitFor(() => screen.getByTestId('workflow-tile-seed-espresso'));
    fireEvent.click(screen.getByTestId('workflow-tile-seed-espresso'));
    expect(onSelect).toHaveBeenCalledWith(sampleWorkflow);
  });

  it('disables Workflow tiles with a droplet icon when water level is at/under the block threshold', async () => {
    const onSelect = vi.fn();
    render(() =>
      buildHome({
        stubs: { water: { currentLevel: 2, refillLevel: 5 } },
        onSelect,
      }),
    );
    await waitFor(() => screen.getByTestId('workflow-tile-seed-espresso'));
    const tile = screen.getByTestId('workflow-tile-seed-espresso') as HTMLButtonElement;
    expect(tile).toBeDisabled();
    expect(screen.getByTestId('workflow-tile-seed-espresso-reason')).toBeInTheDocument();
    fireEvent.click(tile);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('leaves Workflow tiles enabled when water is just above the block threshold (warn-only)', async () => {
    render(() =>
      buildHome({ stubs: { water: { currentLevel: 4, refillLevel: 5 } } }),
    );
    await waitFor(() => screen.getByTestId('workflow-tile-seed-espresso'));
    expect(screen.getByTestId('workflow-tile-seed-espresso')).not.toBeDisabled();
    expect(
      screen.queryByTestId('workflow-tile-seed-espresso-reason'),
    ).not.toBeInTheDocument();
  });

  it('at warn level: header pill + tinted Water row + bottom banner; no inline critical banner', async () => {
    render(() =>
      buildHome({ stubs: { water: { currentLevel: 4, refillLevel: 5 } } }),
    );
    await waitFor(() => screen.getByTestId('workflow-tile-seed-espresso'));
    expect(screen.getByTestId('header-water-pill')).toHaveAttribute(
      'data-severity',
      'warn',
    );
    expect(screen.getByTestId('status-water')).toHaveAttribute(
      'data-severity',
      'warn',
    );
    expect(screen.getByTestId('water-alert-banner')).toHaveAttribute(
      'data-severity',
      'warn',
    );
    expect(screen.queryByTestId('status-water-alert')).not.toBeInTheDocument();
  });

  it('at critical: pill + tinted row + inline banner inside Water cell + bottom banner', async () => {
    render(() =>
      buildHome({ stubs: { water: { currentLevel: 2, refillLevel: 5 } } }),
    );
    await waitFor(() => screen.getByTestId('workflow-tile-seed-espresso'));
    expect(screen.getByTestId('header-water-pill')).toHaveAttribute(
      'data-severity',
      'critical',
    );
    const waterCell = screen.getByTestId('status-water');
    expect(waterCell).toHaveAttribute('data-severity', 'critical');
    const inline = screen.getByTestId('status-water-alert');
    expect(waterCell.contains(inline)).toBe(true);
    expect(screen.getByTestId('water-alert-banner')).toHaveAttribute(
      'data-severity',
      'critical',
    );
  });

  it('refetches the last shot when machine state transitions out of `espresso`', async () => {
    // Drives a controllable machine signal so we can flip the state and verify
    // LastShotCard's fetchSummary fires a second time.
    const machineSig = createSignal<MachineSnapshot | null>(null);
    const [machine, setMachine] = machineSig;
    const machineStream: WsStream<MachineSnapshot> = {
      latest: machine,
      status: createSignal<'open'>('open')[0],
    };

    const fetchLatestShot = vi
      .fn<() => Promise<typeof summary>>()
      .mockResolvedValueOnce({ ...summary, workflow: { name: 'Before brew' } })
      .mockResolvedValueOnce({ ...summary, workflow: { name: 'After brew' } });

    render(() => (
      <Home
        workflowRepository={fakeRepo}
        machineStream={() => machineStream}
        scaleStream={() => ({
          latest: createSignal<ScaleMessage | null>(null)[0],
          status: createSignal<'open'>('open')[0],
        })}
        shotSettingsStream={() => ({
          latest: createSignal<ShotSettingsSnapshot | null>(null)[0],
          status: createSignal<'open'>('open')[0],
        })}
        waterLevelsStream={() => ({
          latest: createSignal<WaterLevelsSnapshot | null>(null)[0],
          status: createSignal<'open'>('open')[0],
        })}
        fetchLatestShot={fetchLatestShot}
        fetchShot={() => Promise.resolve(fullRecord)}
        onSleep={vi.fn()}
        onWake={vi.fn()}
        onUpdateShotSettings={vi.fn()}
        onMenu={vi.fn()}
        onSelectWorkflow={vi.fn()}
        onSeeAllShots={vi.fn()}
      />
    ));

    await waitFor(() => expect(screen.getByText('Before brew')).toBeInTheDocument());
    expect(fetchLatestShot).toHaveBeenCalledTimes(1);

    // Brew starts.
    setMachine({
      timestamp: '2026-05-22T08:00:00Z',
      state: { state: 'espresso', substate: 'pouring' },
      flow: 2,
      pressure: 9,
      targetFlow: 2,
      targetPressure: 9,
      mixTemperature: 92,
      groupTemperature: 93,
      targetMixTemperature: 92,
      targetGroupTemperature: 93,
      profileFrame: 1,
      steamTemperature: 145,
    });
    // No refetch while still brewing.
    expect(fetchLatestShot).toHaveBeenCalledTimes(1);

    // Brew completes — state leaves espresso.
    setMachine({
      timestamp: '2026-05-22T08:00:30Z',
      state: { state: 'idle', substate: 'idle' },
      flow: 0,
      pressure: 0,
      targetFlow: 0,
      targetPressure: 0,
      mixTemperature: 92,
      groupTemperature: 93,
      targetMixTemperature: 92,
      targetGroupTemperature: 93,
      profileFrame: 0,
      steamTemperature: 145,
    });

    await waitFor(() => expect(screen.getByText('After brew')).toBeInTheDocument());
    expect(fetchLatestShot).toHaveBeenCalledTimes(2);
  });

  it('hides all alert indications when water is healthy', async () => {
    render(() =>
      buildHome({ stubs: { water: { currentLevel: 40, refillLevel: 5 } } }),
    );
    await waitFor(() => screen.getByTestId('workflow-tile-seed-espresso'));
    expect(screen.queryByTestId('header-water-pill')).not.toBeInTheDocument();
    expect(screen.queryByTestId('water-alert-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('status-water-alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('status-water')).toHaveAttribute(
      'data-severity',
      'normal',
    );
  });
});
