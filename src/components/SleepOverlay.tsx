import {
  Show,
  createEffect,
  createSignal,
  onCleanup,
  type Accessor,
  type Component,
} from 'solid-js';
import { Logo } from './Logo';

/**
 * Full-screen standby veil shown while the DE1 reports the `sleeping` state.
 * Without it the rest of the UI renders identically whether the machine is
 * awake or asleep — confusing.
 *
 * Lifecycle (driven by `active`, which App gates on `state === 'sleeping'`):
 *   - asleep  → mount + fade the screen to black; the moon + "tap to wake"
 *     hint show clearly for a moment, then fade out so the screen ends up
 *     completely dark (Decenza-style).
 *   - awake   → the black veil fades *out* (so the UI underneath fades back
 *     in) and then unmounts, rather than snapping away.
 *
 * The whole overlay is one big button so a tap *anywhere* — plus Enter /
 * Space for keyboard — wakes the machine, even after the hint has faded.
 * Because `active` tracks machine state, it also dismisses automatically
 * when the machine is woken elsewhere (header button, the machine's own
 * timeout, or the physical GHC).
 */
const FADE_OUT_MS = 600;

export interface SleepOverlayProps {
  /** Whether the machine is asleep — drives mount + the enter/leave fade. */
  active: Accessor<boolean>;
  /** Wake the machine — typically `requestState('idle')`. */
  onWake: () => void;
}

export const SleepOverlay: Component<SleepOverlayProps> = (p) => {
  const [visible, setVisible] = createSignal(p.active());
  const [leaving, setLeaving] = createSignal(false);
  let exitTimer: number | undefined;

  createEffect(() => {
    if (p.active()) {
      if (exitTimer !== undefined) {
        clearTimeout(exitTimer);
        exitTimer = undefined;
      }
      setLeaving(false);
      setVisible(true);
    } else if (visible()) {
      // Fade the veil out so the UI underneath fades back in, then unmount
      // once the animation has run.
      setLeaving(true);
      if (exitTimer !== undefined) clearTimeout(exitTimer);
      exitTimer = window.setTimeout(() => {
        setVisible(false);
        setLeaving(false);
        exitTimer = undefined;
      }, FADE_OUT_MS);
    }
  });

  onCleanup(() => {
    if (exitTimer !== undefined) clearTimeout(exitTimer);
  });

  return (
    <Show when={visible()}>
      <button
        type="button"
        class="sleep-overlay"
        data-state={leaving() ? 'leaving' : 'entering'}
        data-testid="sleep-overlay"
        aria-label="Wake machine"
        onClick={() => p.onWake()}
      >
        <span class="sleep-overlay__content" data-testid="sleep-overlay-content">
          <Logo size={72} />
          <span class="sleep-overlay__hint">Tap to wake</span>
        </span>
      </button>
    </Show>
  );
};
