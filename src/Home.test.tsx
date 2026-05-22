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

  it('Sleep button invokes onSleep', () => {
    const onSleep = vi.fn();
    render(() => buildHome({ onSleep }));
    fireEvent.click(screen.getByRole('button', { name: 'Sleep' }));
    expect(onSleep).toHaveBeenCalledTimes(1);
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
});
