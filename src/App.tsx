import { createEffect, createSignal, type Component } from 'solid-js';
import { api, type GatewayShotRecord } from './api';
import { Home, defaultStreams } from './Home';
import { LiveBrewDrawer } from './components/LiveBrewDrawer';
import { LiveShotProvider, useLiveShot } from './LiveShotContext';
import { frozenToGatewayShotRecord } from './liveShotAdapter';
import { LocalWorkflowRepository } from './repositories';
import type { Workflow } from './domain';
import type {
  MachineSnapshot,
  ScaleMessage,
  ShotSettingsSnapshot,
  WaterLevelsSnapshot,
} from './snapshot';
import type { WsStream } from './streams';

const workflowRepository = new LocalWorkflowRepository();

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

const onMenu = () => console.info('menu — TODO: open drawer');
const onSelectWorkflow = (w: Workflow) =>
  console.info('selected workflow — TODO: route to runtime', w);
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

  return (
    <>
      <div class="home-host" inert={homeInert()} data-testid="home-host">
        <Home
          workflowRepository={workflowRepository}
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
          onSelectWorkflow={onSelectWorkflow}
          onSeeAllShots={onSeeAllShots}
          optimisticShot={optimisticShot}
        />
      </div>
      <LiveBrewDrawer />
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

  return (
    <LiveShotProvider
      machineStream={streams.machine}
      scaleStream={streams.scale}
      fetchWorkflow={api.workflow}
      onStop={onStop}
    >
      <AppBody streams={streams} />
    </LiveShotProvider>
  );
};
