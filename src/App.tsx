import {
  Show,
  Switch,
  Match,
  createEffect,
  createResource,
  createSignal,
  onMount,
  type Component,
} from 'solid-js';
import { api, type GatewayShotRecord } from './api';
import { Home, defaultStreams } from './Home';
import { LiveBrewDrawer } from './components/LiveBrewDrawer';
import { RecipeBrewScreen } from './components/RecipeBrewScreen';
import { SleepOverlay } from './components/SleepOverlay';
import { Settings } from './components/settings/Settings';
import type { ExploreOp } from './components/ExploreTray';
import { buildExploreBrewBundle, EXPLORE_BREW_RECIPE_ID } from './exploreBrew';
import { LiveShotProvider, useLiveShot } from './LiveShotContext';
import { frozenToGatewayShotRecord } from './liveShotAdapter';
import {
  LocalRoutineRepository,
  LocalRecipeRepository,
  linkSeedRecipeProfiles,
} from './repositories';
import { RepositoriesProvider } from './RepositoriesContext';
import { UserPrefsProvider } from './UserPrefsContext';
import type { Recipe } from './domain';
import type {
  MachineSnapshot,
  MachineState,
  ScaleMessage,
  ShotSettingsSnapshot,
  WaterLevelsSnapshot,
} from './snapshot';
import type { WsStream } from './streams';

const routineRepository = new LocalRoutineRepository();
const recipeRepository = new LocalRecipeRepository();

const onSleep = () =>
  api.sleep().catch((e) => console.warn('sleep failed', e));

const onWake = () =>
  api.requestState('idle').catch((e) => console.warn('wake failed', e));

const onStop = () =>
  api.requestState('idle').catch((e) => {
    console.warn('stop failed', e);
  });

const onUpdateShotSettings = (settings: ShotSettingsSnapshot) =>
  api.updateShotSettings(settings).catch((e) =>
    console.warn('updateShotSettings failed', e),
  );

const onSeeAllShots = () => console.info('see all shots — TODO: route to history');

/**
 * Streams are constructed once at the App level and shared between Home (the
 * status panel, last-shot refresh trigger) and LiveShotProvider (live brew
 * accumulator). Re-calling the factories would open duplicate WebSockets.
 *
 * Splitting into App / AppBody is what lets AppBody call `useLiveShot()` —
 * a consumer can't live inside the same component that mounts the provider.
 */
interface AppStreams {
  machine: WsStream<MachineSnapshot>;
  scale: WsStream<ScaleMessage>;
  shotSettings: WsStream<ShotSettingsSnapshot>;
  waterLevels: WsStream<WaterLevelsSnapshot>;
}

const AppBody: Component<{ streams: AppStreams }> = (p) => {
  const live = useLiveShot();
  // Settings overlay is a single-screen swap today (no router). The header's
  // menu button opens it; back / × close it. A future menu drawer would
  // wrap this in a richer navigator.
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const onMenu = () => setSettingsOpen(true);
  const onCloseSettings = () => setSettingsOpen(false);

  // Recipe-brew runtime: another single-screen swap. Tile-tap on Home sets
  // the id; back-arrow or Done clears it. Coexists with settings via the
  // same precedence stack (settings > brew > home).
  const [activeBrewRecipeId, setActiveBrewRecipeId] = createSignal<string | null>(
    null,
  );
  const onSelectRecipe = (r: Recipe) => setActiveBrewRecipeId(r.id);
  const onExitBrew = () => setActiveBrewRecipeId(null);

  // Explore tray: run a machine op directly, no recipe. Steam/water/flush
  // just request the state — the LiveBrewDrawer shows the live view and
  // closes on idle. Brew opens an ad-hoc prep→live→summary built from the
  // gateway's current workflow (fetched fresh each time the flow opens).
  const [exploreBrewing, setExploreBrewing] = createSignal(false);
  const [exploreBundle] = createResource(exploreBrewing, async () => {
    const [workflow, profiles] = await Promise.all([
      api.workflow().catch(() => null),
      api.profiles({}).catch(() => []),
    ]);
    return buildExploreBrewBundle(workflow, profiles);
  });
  const onExplore = (op: ExploreOp) => {
    if (op === 'brew') {
      setExploreBrewing(true);
      return;
    }
    const state: MachineState =
      op === 'steam' ? 'steam' : op === 'water' ? 'hotWater' : 'flush';
    void api.requestState(state).catch((e) => console.warn(`explore ${op} failed`, e));
  };
  // Frozen-shot hand-off to LastShotCard. The signal is *sticky*: it's set
  // once on each freeze and persists until the next brew overwrites it.
  //
  // Why not a memo over `frozenShot()` directly? The drawer resets the
  // accumulator ~280 ms after freeze (so its slide-out animation can run),
  // which clears `frozenShot`. The gateway's /shots/latest takes ~3 s to
  // catch up — leaving a window where the card has neither optimistic nor
  // fresh gateway data, and reverts to showing the *previous* shot. The
  // sticky signal bridges that gap: even after the accumulator clears, the
  // optimistic value sits in the card. Once the gateway returns a shot
  // with timestamp ≥ optimistic's, LastShotCard's `usingOptimistic` flips
  // to the gateway version automatically.
  const [optimisticShot, setOptimisticShot] = createSignal<GatewayShotRecord | null>(
    null,
  );
  createEffect(() => {
    const frozen = live.accumulator.frozenShot();
    if (frozen) {
      setOptimisticShot(frozenToGatewayShotRecord(frozen));
    }
    // Intentionally no `else` — we keep the previous optimistic value alive
    // through the accumulator's reset, until the gateway catches up.
  });

  // Block Home while a brew is in progress. `inert` is the web-standard
  // attribute for this: clicks, focus, and assistive-tech navigation all
  // skip the subtree. CSS gives it a subtle dim so the user sees *why*
  // Home is unresponsive. Keeping it 'frozen' too means the inert layer
  // stays in place during the drawer's slide-out animation — Home doesn't
  // briefly become tappable in the gap between freeze and reset.
  const homeInert = (): boolean => live.accumulator.status() !== 'idle';

  // Standby veil. Driven straight off the machine state, so it appears
  // whenever the DE1 sleeps (header button, its own timeout, physical GHC)
  // and clears the moment it reports any non-sleeping state.
  const isSleeping = (): boolean =>
    p.streams.machine.latest()?.state.state === 'sleeping';

  return (
    <>
      <Show
        when={!settingsOpen()}
        fallback={
          <Settings onBack={onCloseSettings} onClose={onCloseSettings} />
        }
      >
        <Switch
          fallback={
            <div class="home-host" inert={homeInert()} data-testid="home-host">
              <Home
                recipeRepository={recipeRepository}
                machineStream={() => p.streams.machine}
                scaleStream={() => p.streams.scale}
                shotSettingsStream={() => p.streams.shotSettings}
                waterLevelsStream={() => p.streams.waterLevels}
                fetchLatestShot={api.shotsLatest}
                fetchShot={api.shotById}
                onSleep={onSleep}
                onWake={onWake}
                onUpdateShotSettings={onUpdateShotSettings}
                onMenu={onMenu}
                onSelectRecipe={onSelectRecipe}
                onExplore={onExplore}
                onSeeAllShots={onSeeAllShots}
                optimisticShot={optimisticShot}
              />
            </div>
          }
        >
          <Match when={activeBrewRecipeId() !== null}>
            <RecipeBrewScreen
              recipeId={activeBrewRecipeId()!}
              onExit={onExitBrew}
              machineStream={() => p.streams.machine}
              requestState={api.requestState}
              fetchLatestShot={api.shotsLatest}
              fetchShot={api.shotById}
              optimisticShot={optimisticShot}
            />
          </Match>
          <Match when={exploreBrewing()}>
            <Show
              when={!exploreBundle.loading && exploreBundle()}
              fallback={
                <p class="muted brew-screen__loading">preparing brew…</p>
              }
            >
              <RecipeBrewScreen
                recipeId={EXPLORE_BREW_RECIPE_ID}
                bundleOverride={exploreBundle()!}
                onExit={() => setExploreBrewing(false)}
                machineStream={() => p.streams.machine}
                requestState={api.requestState}
                fetchLatestShot={api.shotsLatest}
                fetchShot={api.shotById}
                optimisticShot={optimisticShot}
              />
            </Show>
          </Match>
        </Switch>
      </Show>
      <LiveBrewDrawer />
      {/* Always mounted; it owns its own enter/leave fade off `active`. */}
      <SleepOverlay active={isSleeping} onWake={onWake} />
    </>
  );
};

export const App: Component = () => {
  const streams: AppStreams = {
    machine: defaultStreams.machine(),
    scale: defaultStreams.scale(),
    shotSettings: defaultStreams.shotSettings(),
    waterLevels: defaultStreams.waterLevels(),
  };

  // Link the seed Recipes to their intended profiles by title, once the
  // gateway's profile list is available. Fire-and-forget + non-destructive
  // (only fills an empty profileId), so a gateway hiccup just leaves them
  // unlinked until the next launch and a user's own pick is never clobbered.
  onMount(() => {
    void api
      .profiles({})
      .then((profiles) => linkSeedRecipeProfiles(recipeRepository, profiles))
      .catch((e) => console.warn('link seed profiles failed', e));
  });

  return (
    <UserPrefsProvider>
      <RepositoriesProvider
        routines={routineRepository}
        recipes={recipeRepository}
      >
        <LiveShotProvider
          machineStream={streams.machine}
          scaleStream={streams.scale}
          shotSettingsStream={streams.shotSettings}
          fetchWorkflow={api.workflow}
          onStop={onStop}
          onUpdateShotSettings={onUpdateShotSettings}
          onFetchMachineSettings={() =>
            api.machineSettings().catch((e) => {
              console.warn('fetch machineSettings failed', e);
              return null;
            })
          }
          onUpdateMachineSettings={api.updateMachineSettings}
        >
          <AppBody streams={streams} />
        </LiveShotProvider>
      </RepositoriesProvider>
    </UserPrefsProvider>
  );
};
