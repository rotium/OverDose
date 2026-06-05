import {
  Show,
  Switch,
  Match,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import { api, type GatewayShotRecord } from './api';
import { Home, defaultStreams } from './Home';
import { LiveBrewDrawer } from './components/LiveBrewDrawer';
import { RecipeBrewScreen } from './components/RecipeBrewScreen';
import { SleepOverlay, SLEEP_DARKEN_MS } from './components/SleepOverlay';
import { Settings } from './components/settings/Settings';
import type { ExploreOp } from './components/ExploreTray';
import {
  buildExploreBrewBundle,
  buildExploreSteamBundle,
  EXPLORE_BREW_RECIPE_ID,
  EXPLORE_STEAM_RECIPE_ID,
} from './exploreBrew';
import { LiveShotProvider, useLiveShot } from './LiveShotContext';
import { frozenToGatewayShotRecord } from './liveShotAdapter';
import { linkSeedRecipeProfiles } from './repositories';
import { createLibrarySync } from './librarySync';
import { RepositoriesProvider } from './RepositoriesContext';
import { UserPrefsProvider, useUserPrefs } from './UserPrefsContext';
import { setDebugLogging as setDebugLoggingEnabled, dlog } from './debugLog';
import { deriveActivity } from './machineActivity';
import { isWaterBlocked } from './water';
import type { Recipe } from './domain';
import {
  isScaleStatusFrame,
  type MachineSnapshot,
  type MachineState,
  type ScaleMessage,
  type ShotSettingsSnapshot,
  type WaterLevelsSnapshot,
} from './snapshot';
import type { WsStream } from './streams';

// One library sync for the app: owns the local repos (the mirror) and the
// gateway push/pull. `syncNow` runs on load + focus; see docs/storage-sync.md.
const librarySync = createLibrarySync();
const { recipes: recipeRepository, routines: routineRepository, pitchers: pitcherRepository } =
  librarySync.repos;

const onSleep = () =>
  api.sleep().catch((e) => console.warn('sleep failed', e));

const onWake = () => {
  dlog('intent', 'wake (idle)');
  return api.requestState('idle').catch((e) => console.warn('wake failed', e));
};

// Shared stop path: hit by both the app STOP button and the steam auto
// time-down (which logs its own `steam.autostop` line just before calling
// this). A physical-button stop produces NO line here — the machine state
// just changes — which is exactly how a trace distinguishes app-driven stops
// from physical-button stops.
const onStop = () => {
  dlog('intent', 'stop (idle)');
  return api.requestState('idle').catch((e) => {
    console.warn('stop failed', e);
  });
};

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
  const prefs = useUserPrefs();
  // Water-critical state — shared by the prep-screen Start gate (here)
  // and the ExploreTray's direct-op tile lock (computed independently
  // inside Home, since Home consumes the same stream directly). Critical
  // is the machine's own refill level, reported in the same water frame —
  // so the gate matches when the DE1 itself considers the tank too low.
  const isWaterCritical = (): boolean => {
    const w = p.streams.waterLevels.latest();
    if (!w) return false;
    return isWaterBlocked(w.currentLevel, w.refillLevel);
  };
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

  // Explore tray: run a machine op directly, no recipe. Brew and Steam open
  // an ad-hoc prep→live→summary screen (Brew seeds from the gateway's current
  // workflow; Steam runs the pitcher-pick prep). Water/flush have no prep, so
  // they just request the state — the LiveBrewDrawer shows the live view and
  // closes on idle.
  const [exploreBrewing, setExploreBrewing] = createSignal(false);
  const [exploreSteaming, setExploreSteaming] = createSignal(false);
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
    if (op === 'steam') {
      setExploreSteaming(true);
      return;
    }
    const state: MachineState = op === 'water' ? 'hotWater' : 'flush';
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

  // ── Developer logging ──
  // Mirror the pref into the leaf logger, then log the events that matter for
  // diagnosing the brew/steam flow: machine state+activity transitions and
  // steam-duration changes. `dlog` is a no-op while logging is off.
  createEffect(() => setDebugLoggingEnabled(prefs.debugLogging()));
  let lastStateKey = '';
  createEffect(() => {
    const snap = p.streams.machine.latest();
    if (!snap) return;
    const key = `${snap.state.state}/${snap.state.substate}`;
    if (key === lastStateKey) return;
    lastStateKey = key;
    dlog('state', `${key}  →  ${deriveActivity(snap).kind}`);
  });
  let lastSteamDur: number | undefined;
  createEffect(() => {
    const ss = p.streams.shotSettings.latest();
    if (!ss || ss.targetSteamDuration === lastSteamDur) return;
    lastSteamDur = ss.targetSteamDuration;
    dlog('steamDur', `${ss.targetSteamDuration}s`);
  });

  // ── Steam purge strategy: firmware write-through ──
  // The skin owns the purge strategy; mirror it onto the firmware
  // `steamPurgeMode` (0 = machine auto-purge, 1 = two-tap so the skin/user
  // drives the purge). Write once per connection and whenever the strategy
  // changes — `connected` is a memo so this doesn't run on every (~10 Hz)
  // frame, only on connect/disconnect edges.
  const machineConnected = createMemo(() => p.streams.machine.latest() !== null);

  // Live scale-connection state — drives which auto-stop modes the brew prep
  // offers. The scale WS stays open even with no scale paired, so combine the
  // socket status with the latest frame (status frame says connected, or a
  // data frame implies it). Same derivation the header pill uses (Home.tsx).
  const scaleConnected = createMemo<boolean>(() => {
    const s = p.streams.scale;
    if (s.status() !== 'open') return false;
    const frame = s.latest();
    if (!frame) return false;
    return isScaleStatusFrame(frame) ? frame.status === 'connected' : true;
  });
  let lastWrittenPurgeMode: number | null = null;
  createEffect(() => {
    const strat = prefs.steamPurgeStrategy();
    if (!machineConnected()) {
      lastWrittenPurgeMode = null; // re-sync on the next connection
      return;
    }
    const desired = strat === 'firmware' ? 0 : 1;
    if (desired === lastWrittenPurgeMode) return;
    lastWrittenPurgeMode = desired;
    dlog('steam', `write steamPurgeMode=${desired} (strategy=${strat})`);
    void api
      .updateMachineSettings({ steamPurgeMode: desired })
      .catch((e) => console.warn('write steamPurgeMode failed', e));
  });

  // ── Steam purge orchestration (autoFlush) ──
  // When steam stops the firmware parks (phase → 'purging'). In `autoFlush`
  // mode we deliberately fire the purge (a second idle) after the configured
  // dwell, instead of leaving the machine parked until its own steam-length
  // timeout. `firmware` needs nothing (mode 0 already purged on the single
  // stop); `manual` waits for the user's Purge button. Fires once per session
  // (`purgeFired`); the timer is cancelled if the session ends first.
  let purgeTimer: ReturnType<typeof setTimeout> | undefined;
  let purgeFired = false;
  const cancelPurgeTimer = (): void => {
    if (purgeTimer !== undefined) {
      clearTimeout(purgeTimer);
      purgeTimer = undefined;
    }
  };
  createEffect(() => {
    const session = live.operationSession;
    const active = session.status() === 'active' && session.kind() === 'steam';
    if (!active) {
      cancelPurgeTimer();
      purgeFired = false;
      return;
    }
    if (session.phase() !== 'purging' || purgeFired) return;
    if (prefs.steamPurgeStrategy() !== 'autoFlush') return;
    purgeFired = true;
    const dwellMs = Math.max(0, prefs.steamAutoFlushSec()) * 1000;
    dlog('steam', `autoFlush: purge in ${dwellMs}ms`);
    purgeTimer = setTimeout(() => {
      purgeTimer = undefined;
      dlog('steam', 'autoFlush: firing purge (idle)');
      void onStop().catch((e) => console.warn('auto-flush purge failed', e));
    }, dwellMs);
  });
  onCleanup(cancelPurgeTimer);

  // Standby veil. Driven straight off the machine state, so it appears
  // whenever the DE1 sleeps (header button, its own timeout, physical GHC)
  // and clears the moment it reports any non-sleeping state. A memo so the
  // screen-off effect below fires only on real sleep/wake transitions, not on
  // every (~10 Hz) machine snapshot.
  const isSleeping = createMemo(
    () => p.streams.machine.latest()?.state.state === 'sleeping',
  );

  // ── Screen-off on sleep (backlight to 0) ──
  // The SleepOverlay paints the screen black, but that's a black page at full
  // backlight. To actually darken the panel we drop the gateway's brightness
  // to 0 — but only AFTER the overlay's darkening animation has run
  // (SLEEP_DARKEN_MS), so the fade + "tap to wake" reveal stays visible.
  // Cutting earlier would hide it; by then the page is already black, so the
  // cut is invisible. Restored to OS-managed brightness on wake.
  //
  // Brightness 0 is a *software* off: the screen only comes back if a restore
  // lands. So we re-assert it on every wake transition, immediately on the wake
  // gesture (don't wait for the idle snapshot), and on mount/reload (the awake
  // branch). The gateway also restores on sleeping→idle independently, so a
  // one-off failed restore self-heals instead of stranding a black screen.
  const restoreBrightness = (): void => {
    void api.setBrightness(100).catch(() => {}); // 100 = OS-managed
  };
  let darkenTimer: number | undefined;
  const clearDarken = (): void => {
    if (darkenTimer !== undefined) {
      clearTimeout(darkenTimer);
      darkenTimer = undefined;
    }
  };
  createEffect(() => {
    if (isSleeping()) {
      clearDarken();
      darkenTimer = window.setTimeout(() => {
        darkenTimer = undefined;
        if (isSleeping()) void api.setBrightness(0).catch(() => {});
      }, SLEEP_DARKEN_MS);
    } else {
      clearDarken();
      restoreBrightness();
    }
  });
  onCleanup(clearDarken);

  // Wake from the veil: re-light instantly (don't wait for the machine to
  // report idle), cancel any pending backlight cut, then request wake.
  const onWakeFromOverlay = (): void => {
    clearDarken();
    restoreBrightness();
    onWake();
  };

  return (
    <>
      <Show
        when={!settingsOpen()}
        fallback={
          <Settings
            onBack={onCloseSettings}
            onClose={onCloseSettings}
            shotSettingsStream={p.streams.shotSettings}
            waterLevelsStream={p.streams.waterLevels}
          />
        }
      >
        <Switch
          fallback={
            <div class="home-host" inert={homeInert()} data-testid="home-host">
              <Home
                recipeRepository={recipeRepository}
                recipeRevision={librarySync.revision}
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
              scaleConnected={scaleConnected}
              autoStopMode={() => prefs.autoStopMode()}
              isWaterCritical={isWaterCritical}
              requestState={api.requestState}
              shotSettingsStream={() => p.streams.shotSettings}
              showFlowSlider={() => prefs.showSteamFlowSlider()}
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
                scaleConnected={scaleConnected}
                autoStopMode={() => prefs.autoStopMode()}
                isWaterCritical={isWaterCritical}
                requestState={api.requestState}
                shotSettingsStream={() => p.streams.shotSettings}
                showFlowSlider={() => prefs.showSteamFlowSlider()}
                fetchLatestShot={api.shotsLatest}
                fetchShot={api.shotById}
                optimisticShot={optimisticShot}
              />
            </Show>
          </Match>
          <Match when={exploreSteaming()}>
            <RecipeBrewScreen
              recipeId={EXPLORE_STEAM_RECIPE_ID}
              bundleOverride={buildExploreSteamBundle()}
              onExit={() => setExploreSteaming(false)}
              machineStream={() => p.streams.machine}
              scaleConnected={scaleConnected}
              autoStopMode={() => prefs.autoStopMode()}
              isWaterCritical={isWaterCritical}
              requestState={api.requestState}
              shotSettingsStream={() => p.streams.shotSettings}
              showFlowSlider={() => prefs.showSteamFlowSlider()}
              fetchLatestShot={api.shotsLatest}
              fetchShot={api.shotById}
              optimisticShot={optimisticShot}
            />
          </Match>
        </Switch>
      </Show>
      <LiveBrewDrawer />
      {/* Always mounted; it owns its own enter/leave fade off `active`. */}
      <SleepOverlay active={isSleeping} onWake={onWakeFromOverlay} />
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

  onMount(() => {
    void (async () => {
      // Sync the library FIRST so a populated gateway is pulled before any
      // local enrichment runs — otherwise linkSeed could bump the local
      // timestamp and push fresh seeds over real gateway data. See the
      // first-run rule in docs/storage-sync.md.
      await librarySync.syncNow();
      // Then link seed Recipes to their gateway profiles by title. Idempotent +
      // non-destructive (only fills an empty profileId); after a pull the
      // recipes are already linked, so this is a no-op on existing libraries.
      try {
        const profiles = await api.profiles({});
        await linkSeedRecipeProfiles(recipeRepository, profiles);
      } catch (e) {
        console.warn('link seed profiles failed', e);
      }
    })();

    // Re-sync when the tab/window regains focus — catches edits made on other
    // devices. No interval polling (see docs/storage-sync.md).
    const onVisible = () => {
      if (document.visibilityState === 'visible') void librarySync.syncNow();
    };
    document.addEventListener('visibilitychange', onVisible);
    onCleanup(() => {
      document.removeEventListener('visibilitychange', onVisible);
      librarySync.dispose();
    });
  });

  return (
    <UserPrefsProvider
      gatewayStore={{ get: api.storeGet, set: api.storeSet }}
    >
      <RepositoriesProvider
        routines={routineRepository}
        recipes={recipeRepository}
        pitchers={pitcherRepository}
        revision={librarySync.revision}
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
