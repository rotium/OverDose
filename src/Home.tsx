import { createEffect, createSignal, type Accessor, type Component } from 'solid-js';
import { api, type GatewayShotRecord } from './api';
import { Header } from './components/Header';
import { LastShotCard } from './components/LastShotCard';
import { StatusPanel } from './components/StatusPanel';
import { WaterAlertBanner } from './components/WaterAlertBanner';
import { RecipePicker } from './components/RecipePicker';
import type { DisabledReason } from './components/RecipeTile';
import type { Recipe } from './domain';
import type { RecipeRepository } from './repositories';
import type {
  MachineSnapshot,
  ScaleMessage,
  ShotSettingsSnapshot,
  WaterLevelsSnapshot,
} from './snapshot';
import { createWsStream, type WsStream } from './streams';
import { useUserPrefs } from './UserPrefsContext';
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
  recipeRepository: RecipeRepository;
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
  onSelectRecipe: (r: Recipe) => void;
  onSeeAllShots: () => void;
  /**
   * Optimistic in-memory shot for the LastShotCard hand-off (populated by
   * App.tsx from the LiveShot accumulator the instant a brew freezes).
   * Optional so Home tests don't need to wire up the live-shot stack.
   */
  optimisticShot?: Accessor<GatewayShotRecord | null>;
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

  const prefs = useUserPrefs();

  // Single source of truth for the water-alert UI. Before any frame arrives
  // we say 'normal' — a missing snapshot shouldn't pretend the tank is empty.
  const severity = (): WaterSeverity => {
    const w = waterLevels.latest();
    return w
      ? waterSeverity(w.currentLevel, prefs.waterWarnMm(), prefs.waterBlockMm())
      : 'normal';
  };

  // Mirrors streamline.js: button shows "Sleep" (moon) when awake, "Awake"
  // (sun) when sleeping; clicking toggles between machine states.
  const isSleeping = (): boolean =>
    machine.latest()?.state.state === 'sleeping';

  const handleToggleSleep = () => {
    if (isSleeping()) p.onWake();
    else p.onSleep();
  };

  // Tick that increments every time we detect a brew just ended. The gateway
  // doesn't emit a shot-complete event, so we derive it from snapshot stream
  // transitions. We trigger on two signals — whichever arrives first wins:
  //   1. `state` leaves `espresso` (the canonical end-of-shot transition)
  //   2. `substate` enters `pouringDone` (often arrives a couple frames before
  //      the state flip, depending on how the gateway closes out the shot)
  // Starts at 1 (truthy) so the card's initial mount-fetch still runs.
  const [shotCompletedTick, setShotCompletedTick] = createSignal(1);
  let prevState: string | undefined;
  let prevSubstate: string | undefined;
  createEffect(() => {
    const snap = machine.latest();
    const curState = snap?.state.state;
    const curSubstate = snap?.state.substate;

    const stateLeftEspresso =
      prevState === 'espresso' && curState !== undefined && curState !== 'espresso';
    const enteredPouringDone =
      prevSubstate !== 'pouringDone' && curSubstate === 'pouringDone';

    if (stateLeftEspresso || enteredPouringDone) {
      console.info(
        '[Home] brew complete — refetching last shot',
        { prevState, curState, prevSubstate, curSubstate },
      );
      setShotCompletedTick((n) => n + 1);
    }
    prevState = curState;
    prevSubstate = curSubstate;
  });

  // Block tiles (with droplet icon) only at the critical threshold.
  const disabledReason = (): DisabledReason | null => {
    const w = waterLevels.latest();
    if (!w) return null;
    return isWaterBlocked(w.currentLevel, prefs.waterBlockMm())
      ? 'low-water'
      : null;
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
          <RecipePicker
            repository={p.recipeRepository}
            onSelect={p.onSelectRecipe}
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
            refreshKey={shotCompletedTick}
            optimisticShot={p.optimisticShot}
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
