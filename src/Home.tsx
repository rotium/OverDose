import { type Component } from 'solid-js';
import { api } from './api';
import { Header } from './components/Header';
import { LastShotCard } from './components/LastShotCard';
import { StatusPanel } from './components/StatusPanel';
import { WorkflowPicker } from './components/WorkflowPicker';
import type { Workflow } from './domain';
import type { WorkflowRepository } from './repositories';
import type {
  MachineSnapshot,
  ScaleMessage,
  ShotSettingsSnapshot,
  WaterLevelsSnapshot,
} from './snapshot';
import { createWsStream, type WsStream } from './streams';

/**
 * Home — the entry screen. Composes the live data streams + the injected
 * repositories into the agreed Decent-tablet layout (Header, picker left,
 * status + last-shot stacked right).
 *
 * All side-effecting collaborators are injected (repository, the four WS
 * stream factories, the two REST fetchers). This keeps Home itself a pure
 * composer and lets tests drive it without a network.
 */
export interface HomeProps {
  workflowRepository: WorkflowRepository;
  /** Stream factories — defaulted to the real reaprime WS endpoints in App.tsx. */
  machineStream: () => WsStream<MachineSnapshot>;
  scaleStream: () => WsStream<ScaleMessage>;
  shotSettingsStream: () => WsStream<ShotSettingsSnapshot>;
  waterLevelsStream: () => WsStream<WaterLevelsSnapshot>;
  /** Allows tests to swap REST. */
  fetchLatestShot: () => ReturnType<typeof api.shotsLatest>;
  fetchShot: (id: string) => ReturnType<typeof api.shotById>;
  /** Action handlers (defaulted to api.* in App.tsx). */
  onSleep: () => void;
  onUpdateShotSettings: (settings: ShotSettingsSnapshot) => void;
  onMenu: () => void;
  onSelectWorkflow: (w: Workflow) => void;
  onSeeAllShots: () => void;
}

export const Home: Component<HomeProps> = (p) => {
  const machine = p.machineStream();
  const scale = p.scaleStream();
  const shotSettings = p.shotSettingsStream();
  const waterLevels = p.waterLevelsStream();

  const handleSteamToggle = (next: boolean) => {
    const current = shotSettings.latest();
    if (!current) return;
    p.onUpdateShotSettings({ ...current, steamSetting: next ? 1 : 0 });
  };

  return (
    <div class="home">
      <Header
        machineStatus={machine.status}
        scaleStatus={scale.status}
        onMenu={p.onMenu}
        onSleep={p.onSleep}
      />
      <main class="home__main">
        <div class="home__picker">
          <WorkflowPicker
            repository={p.workflowRepository}
            onSelect={p.onSelectWorkflow}
          />
        </div>
        <aside class="home__sidebar">
          <StatusPanel
            machine={machine.latest}
            scale={scale.latest}
            shotSettings={shotSettings.latest}
            waterLevels={waterLevels.latest}
            onSteamToggle={handleSteamToggle}
          />
          <LastShotCard
            fetchSummary={p.fetchLatestShot}
            fetchFull={p.fetchShot}
            onSeeAll={p.onSeeAllShots}
          />
        </aside>
      </main>
    </div>
  );
};

/** Real-streams factory used by App.tsx — kept here so Home's deps stay testable. */
export const defaultStreams = {
  machine: () => createWsStream<MachineSnapshot>('/ws/v1/machine/snapshot', 'machine'),
  scale: () => createWsStream<ScaleMessage>('/ws/v1/scale/snapshot', 'scale'),
  shotSettings: () =>
    createWsStream<ShotSettingsSnapshot>('/ws/v1/machine/shotSettings', 'shotSettings'),
  waterLevels: () =>
    createWsStream<WaterLevelsSnapshot>('/ws/v1/machine/waterLevels', 'waterLevels'),
};
