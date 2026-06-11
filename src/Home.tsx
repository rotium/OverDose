import { createEffect, createSignal, type Accessor, type Component } from 'solid-js';
import { api, type GatewayShotRecord } from './api';
import { Header } from './components/Header';
import { LastShotCard } from './components/LastShotCard';
import { StatusPanel } from './components/StatusPanel';
import { RecipePicker } from './components/RecipePicker';
import {
  ExploreTray,
  type ExploreBlockReason,
  type ExploreOp,
} from './components/ExploreTray';
import type { Cleaning, Recipe } from './domain';
import type { RecipeRepository } from './repositories';
import {
  isHeaterOff,
  isScaleStatusFrame,
  isWarmingUp,
  type MachineSnapshot,
  type ScaleMessage,
  type ShotSettingsSnapshot,
  type WaterLevelsSnapshot,
} from './snapshot';
import type { WsStatus } from './streams';
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
  /** Library revision — passed to the recipe picker so it re-runs on a gateway
   *  sync pull. Optional (tests omit it). See docs/storage-sync.md. */
  recipeRevision?: Accessor<number>;
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
  onMaintenance?: () => void;
  /** Cleanings currently due — surfaced as header alert pills. */
  dueCleanings?: Accessor<Cleaning[]>;
  /** Tap a due-cleaning pill (opens Maintenance). */
  onCleaningPill?: (c: Cleaning) => void;
  onSelectRecipe: (r: Recipe) => void;
  /** Run a machine op directly from the Explore tray. `brew` opens the
   *  ad-hoc prep flow; steam/water/flush start immediately. */
  onExplore: (op: ExploreOp) => void;
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
      ? waterSeverity(w.currentLevel, prefs.waterWarnMm(), w.refillLevel)
      : 'normal';
  };

  // Mirrors streamline.js: button shows "Sleep" (moon) when awake, "Awake"
  // (sun) when sleeping; clicking toggles between machine states.
  const isSleeping = (): boolean =>
    machine.latest()?.state.state === 'sleeping';

  const isWarming = (): boolean => isWarmingUp(machine.latest() ?? null);
  const heaterOff = (): boolean => isHeaterOff(machine.latest() ?? null);

  // The scale WS is held open by the gateway regardless of whether a scale
  // is actually paired — the BLE-level state is signalled via status frames
  // (`{status:'connected'|'disconnected'}`) interleaved with the weight
  // data frames. So `scale.status` alone reports "online" any time the
  // WebSocket is up, even on a machine with no scale. Combine both signals
  // so the header pill reflects the real connectedness.
  const scalePillStatus = (): WsStatus => {
    const ws = scale.status();
    if (ws !== 'open') return ws;
    const frame = scale.latest();
    if (!frame) return 'connecting'; // open WS but no status frame yet
    if (isScaleStatusFrame(frame)) {
      return frame.status === 'connected' ? 'open' : 'closed';
    }
    return 'open'; // a data frame implies the scale was connected at that tick
  };

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

  // Resolve why the Explore direct-op tiles (steam/water/flush) should be
  // disabled. Recipe tiles and the Explore "Brew" tile are always navigable
  // — gating happens at the prep-screen Start. These direct ops have no
  // prep intermediate, so we block them at the tile. Heater-off wins over
  // water-critical when both apply (heater is the more fundamental block).
  const exploreBlockReason = (): ExploreBlockReason | null => {
    if (heaterOff()) return 'heater-off';
    const w = waterLevels.latest();
    if (w && isWaterBlocked(w.currentLevel, w.refillLevel)) {
      return 'water-critical';
    }
    return null;
  };

  return (
    <div class="home">
      <Header
        machineStatus={machine.status}
        scaleStatus={scalePillStatus}
        showScale={prefs.hasScale}
        waterSeverity={severity}
        isSleeping={isSleeping}
        isWarming={isWarming}
        isHeaterOff={heaterOff}
        onMenu={p.onMenu}
        onMaintenance={p.onMaintenance}
        dueCleanings={p.dueCleanings}
        onCleaningPill={p.onCleaningPill}
        onToggleSleep={handleToggleSleep}
      />
      <main class="home__main">
        <div class="home__left">
          <div class="home__picker">
            <RecipePicker
              repository={p.recipeRepository}
              onSelect={p.onSelectRecipe}
              revision={p.recipeRevision}
            />
          </div>
          <ExploreTray
            onSelect={p.onExplore}
            blockReason={exploreBlockReason}
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
