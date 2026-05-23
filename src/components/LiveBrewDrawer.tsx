import {
  Show,
  createEffect,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js';
import { useLiveShot } from '../LiveShotContext';
import { LiveEspressoView } from './operations/LiveEspressoView';

/**
 * Bottom drawer that overlays Home during a brew. "Smart progress bar" —
 * fully machine-driven, no manual close button. Lifecycle:
 *
 *   accumulator status = 'recording'  → drawer slides up
 *   accumulator status = 'frozen'     → drawer slides down, then status resets to idle
 *   accumulator status = 'idle'       → drawer unmounted
 *
 * The slide-down doesn't immediately unmount; we wait for the CSS
 * transition to finish before resetting the accumulator (so the chart
 * doesn't blank out mid-animation).
 */

const SLIDE_OUT_MS = 280;

export const LiveBrewDrawer: Component = () => {
  const { accumulator, stop } = useLiveShot();
  const [visible, setVisible] = createSignal(false);
  const [animatingOut, setAnimatingOut] = createSignal(false);
  let exitTimer: number | undefined;

  // Single effect driving the open/close + reset. Tracks the accumulator's
  // status only — the per-frame heat is consumed by the chart, not this.
  createEffect(() => {
    const s = accumulator.status();
    if (s === 'recording') {
      // Open (or stay open if already open from a previous shot).
      if (exitTimer !== undefined) {
        clearTimeout(exitTimer);
        exitTimer = undefined;
      }
      setAnimatingOut(false);
      setVisible(true);
    } else if (s === 'frozen') {
      // Trigger slide-out; reset accumulator after animation finishes so
      // the in-memory shot stays available to LastShotCard during hand-off.
      setAnimatingOut(true);
      if (exitTimer !== undefined) clearTimeout(exitTimer);
      exitTimer = window.setTimeout(() => {
        setVisible(false);
        setAnimatingOut(false);
        accumulator.reset();
        exitTimer = undefined;
      }, SLIDE_OUT_MS);
    } else {
      // idle — fully closed.
      setVisible(false);
      setAnimatingOut(false);
    }
  });

  onCleanup(() => {
    if (exitTimer !== undefined) clearTimeout(exitTimer);
  });

  return (
    <Show when={visible()}>
      <div
        class="live-brew-drawer"
        data-state={animatingOut() ? 'closing' : 'open'}
        role="dialog"
        aria-label="Live brew"
        data-testid="live-brew-drawer"
      >
        <LiveEspressoView acc={accumulator} onStop={() => void stop()} />
      </div>
    </Show>
  );
};
