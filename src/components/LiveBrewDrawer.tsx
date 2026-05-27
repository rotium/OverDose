import {
  Show,
  Switch,
  Match,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js';
import { useLiveShot } from '../LiveShotContext';
import { useUserPrefs } from '../UserPrefsContext';
import {
  isScaleStatusFrame,
  type MachineState,
  type ScaleMessage,
  type ShotSettingsSnapshot,
} from '../snapshot';
import { LiveEspressoView } from './operations/LiveEspressoView';
import { LiveSteamView } from './operations/LiveSteamView';
import { LiveWaterView } from './operations/LiveWaterView';
import { LiveFlushView } from './operations/LiveFlushView';

/**
 * Bottom drawer that overlays Home during a live operation (espresso, steam,
 * hot water, flush). "Smart progress bar" — fully machine-driven, no manual
 * close button. STOP requests idle.
 *
 * Open conditions are the union of per-operation lifecycles:
 *   - accumulator.status() !== 'idle'        → espresso shot in progress / freezing
 *   - operationSession.status() === 'active' → machine is steaming / dispensing / flushing
 *
 * Either entering opens the drawer; both leaving closes it (with a 280 ms
 * slide-out, after which the accumulator is reset so LastShotCard can pick
 * up the optimistic frozen shot before it clears).
 */

const SLIDE_OUT_MS = 280;

/** Which non-espresso view to render for a given machine state. `airPurge`
 *  is the firmware's trailing wand-purge after steam — the steam session
 *  stays active across it (see LiveShotContext), so the steam view keeps
 *  rendering and just swaps its hero to "purging". */
const operationFor = (
  s: MachineState | undefined,
): 'steam' | 'water' | 'flush' | null => {
  if (s === 'steam' || s === 'airPurge') return 'steam';
  if (s === 'hotWater') return 'water';
  if (s === 'flush') return 'flush';
  return null;
};

export const LiveBrewDrawer: Component = () => {
  const ctx = useLiveShot();
  const prefs = useUserPrefs();
  const {
    accumulator,
    operationSession,
    machineStream,
    scaleStream,
    shotSettingsStream,
    stop,
    extendSteam,
    machineSettings,
    updateMachineSettings,
  } = ctx;
  const [visible, setVisible] = createSignal(false);
  const [animatingOut, setAnimatingOut] = createSignal(false);
  let exitTimer: number | undefined;

  // Composite "should this drawer be open" — any live-op lifecycle being
  // non-idle counts. The espresso accumulator gets two open-states
  // ('recording' + 'frozen'), so its slide-out window covers the hand-off
  // to LastShotCard. Steam/water/flush have a simpler 'active' → 'idle'
  // transition.
  const isOpenSource = createMemo<boolean>(
    () =>
      accumulator.status() === 'recording' ||
      operationSession.status() === 'active',
  );
  const isClosingSource = createMemo<boolean>(
    () => accumulator.status() === 'frozen',
  );

  // Choose which view to render. Prefer espresso while the accumulator
  // is non-idle (covers the slide-out animation after a shot completes,
  // when the machine state has already gone to idle but we still want to
  // show the espresso view as it animates out). Otherwise the active
  // operation session names the body; the machine-state fallback keeps the
  // last view mounted during the slide-out after the session goes idle.
  const activeView = createMemo<'espresso' | 'steam' | 'water' | 'flush' | null>(
    () => {
      if (accumulator.status() !== 'idle') return 'espresso';
      if (operationSession.status() === 'active') return operationSession.kind();
      return operationFor(machineStream.latest()?.state.state);
    },
  );

  // Live scale state for the water hero. A status frame carries connectedness
  // without a weight; a data frame implies connected and carries the weight.
  const scaleConnected = (): boolean => {
    const m = scaleStream.latest();
    if (!m) return false;
    return isScaleStatusFrame(m) ? m.status === 'connected' : true;
  };
  const scaleWeight = (): number | undefined => {
    const m: ScaleMessage | null = scaleStream.latest() ?? null;
    if (!m || isScaleStatusFrame(m)) return undefined;
    return m.weight;
  };

  // Single effect driving the open/close + reset. Tracks the per-op
  // signals only — the per-frame heat is consumed by each view, not this.
  createEffect(() => {
    if (isOpenSource()) {
      if (exitTimer !== undefined) {
        clearTimeout(exitTimer);
        exitTimer = undefined;
      }
      setAnimatingOut(false);
      setVisible(true);
    } else if (isClosingSource()) {
      // Espresso path: defer reset until after the slide-out animation
      // so LastShotCard can read the frozen shot mid-transition.
      setAnimatingOut(true);
      if (exitTimer !== undefined) clearTimeout(exitTimer);
      exitTimer = window.setTimeout(() => {
        setVisible(false);
        setAnimatingOut(false);
        accumulator.reset();
        exitTimer = undefined;
      }, SLIDE_OUT_MS);
    } else if (visible()) {
      // Steam / other paths: no frozen-state to wait for. Trigger the
      // same slide-out animation, then unmount.
      setAnimatingOut(true);
      if (exitTimer !== undefined) clearTimeout(exitTimer);
      exitTimer = window.setTimeout(() => {
        setVisible(false);
        setAnimatingOut(false);
        exitTimer = undefined;
      }, SLIDE_OUT_MS);
    }
  });

  onCleanup(() => {
    if (exitTimer !== undefined) clearTimeout(exitTimer);
  });

  const shotSettingsAccessor = (): ShotSettingsSnapshot | null =>
    shotSettingsStream ? (shotSettingsStream.latest() ?? null) : null;

  return (
    <Show when={visible()}>
      <div
        class="live-brew-drawer"
        data-state={animatingOut() ? 'closing' : 'open'}
        role="dialog"
        aria-label="Live brew"
        data-testid="live-brew-drawer"
      >
        <Switch>
          <Match when={activeView() === 'espresso'}>
            <LiveEspressoView acc={accumulator} onStop={() => void stop()} />
          </Match>
          <Match when={activeView() === 'steam'}>
            <LiveSteamView
              machineSnapshot={() => machineStream.latest() ?? null}
              shotSettings={shotSettingsAccessor}
              startedAtMs={operationSession.startedAtMs}
              phase={operationSession.phase}
              onStop={() => void stop()}
              onExtend={(delta) => void extendSteam(delta)}
              steamFlow={() => machineSettings()?.steamFlow}
              onChangeSteamFlow={(v) =>
                void updateMachineSettings({ steamFlow: v })
              }
              showSlider={prefs.showSteamFlowSlider()}
            />
          </Match>
          <Match when={activeView() === 'water'}>
            <LiveWaterView
              machineSnapshot={() => machineStream.latest() ?? null}
              shotSettings={shotSettingsAccessor}
              startedAtMs={operationSession.startedAtMs}
              scaleWeight={scaleWeight}
              scaleConnected={scaleConnected}
              onStop={() => void stop()}
              flow={() => machineSettings()?.hotWaterFlow}
              onChangeFlow={(v) =>
                void updateMachineSettings({ hotWaterFlow: v })
              }
              showSlider={prefs.showWaterFlowSlider()}
            />
          </Match>
          <Match when={activeView() === 'flush'}>
            <LiveFlushView
              machineSnapshot={() => machineStream.latest() ?? null}
              startedAtMs={operationSession.startedAtMs}
              targetDurationSec={() => machineSettings()?.flushTimeout}
              onStop={() => void stop()}
              flow={() => machineSettings()?.flushFlow}
              onChangeFlow={(v) =>
                void updateMachineSettings({ flushFlow: v })
              }
              showSlider={prefs.showFlushFlowSlider()}
            />
          </Match>
        </Switch>
      </div>
    </Show>
  );
};
