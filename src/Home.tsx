import { type Component } from 'solid-js';
import { api } from './api';
import { Header } from './components/Header';
import { LastShotCard } from './components/LastShotCard';
import { StatusPanel } from './components/StatusPanel';
import { WaterAlertBanner } from './components/WaterAlertBanner';
import { WorkflowPicker } from './components/WorkflowPicker';
import type { DisabledReason } from './components/WorkflowTile';
import type { Workflow } from './domain';
import type { WorkflowRepository } from './repositories';
import type {
  MachineSnapshot,
  ScaleMessage,
  ShotSettingsSnapshot,
  WaterLevelsSnapshot,
} from './snapshot';
import { createWsStream, type WsStream } from './streams';
import { isWaterBlocked, waterSeverity, type WaterSeverity } from './water';

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
  /** Wake the machine from sleeping state — typically `requestState('idle')`. */
  onWake: () => void;
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

  // Single source of truth for the water-alert UI. Before any frame arrives
  // we say 'normal' — a missing snapshot shouldn't pretend the tank is empty.
  const severity = (): WaterSeverity => {
    const w = waterLevels.latest();
    return w ? waterSeverity(w.currentLevel) : 'normal';
  };

  // Mirrors streamline.js: button shows "Sleep" (moon) when awake, "Awake"
  // (sun) when sleeping; clicking toggles between machine states.
  const isSleeping = (): boolean =>
    machine.latest()?.state.state === 'sleeping';

  const handleToggleSleep = () => {
    if (isSleeping()) p.onWake();
    else p.onSleep();
  };

  // Block tiles (with droplet icon) only at the critical threshold.
  const disabledReason = (): DisabledReason | null => {
    const w = waterLevels.latest();
    if (!w) return null;
    return isWaterBlocked(w.currentLevel) ? 'low-water' : null;
  };

  return (
    <div class="home">
      <Header
        machineStatus={machine.status}
        scaleStatus={scale.status}
        waterSeverity={severity}
        isSleeping={isSleeping}
        onMenu={p.onMenu}
        onToggleSleep={handleToggleSleep}
      />
      <main class="home__main">
        <div class="home__picker">
          <WorkflowPicker
            repository={p.workflowRepository}
            onSelect={p.onSelectWorkflow}
            disabledReason={disabledReason}
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
      <WaterAlertBanner severity={severity} />
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
