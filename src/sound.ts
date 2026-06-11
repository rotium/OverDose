/**
 * Tiny audio-cue player for the sleep/wake transitions.
 *
 * The gateway WebView sets `mediaPlaybackRequiresUserGesture: false`
 * (reaprime skin_view.dart), so these cues play on machine-driven events
 * without a preceding tap. In a plain dev browser the first play may be
 * blocked by the autoplay policy until the user interacts — we swallow that
 * rejection so a blocked cue is silently a no-op, never an error.
 *
 * Clips live in public/sounds/ and are served at /sounds/*.
 */
export type Cue =
  | 'sleep'
  | 'wake'
  | 'ready'
  | 'waterLow'
  | 'waterCritical'
  | 'cleaningDue';

const SOURCES: Record<Cue, string> = {
  sleep: '/sounds/sleep.mp3',
  wake: '/sounds/wake.mp3',
  ready: '/sounds/ready.mp3',
  waterLow: '/sounds/water-low.mp3',
  waterCritical: '/sounds/water-critical.mp3',
  cleaningDue: '/sounds/cleaning-due.mp3',
};

// Reused, preloaded Audio elements (built lazily so module load is cheap and
// SSR/test environments without `Audio` don't blow up at import time).
const cache = new Map<Cue, HTMLAudioElement>();

const element = (cue: Cue): HTMLAudioElement | null => {
  if (typeof Audio === 'undefined') return null;
  let a = cache.get(cue);
  if (!a) {
    a = new Audio(SOURCES[cue]);
    a.preload = 'auto';
    cache.set(cue, a);
  }
  return a;
};

/**
 * Play a cue. Resets to the start so rapid re-triggers restart cleanly.
 * Never throws: a blocked autoplay (dev browser) or an environment without
 * media support (jsdom) is a no-op.
 */
export const playCue = (cue: Cue): void => {
  try {
    const a = element(cue);
    if (!a) return;
    a.currentTime = 0;
    const r = a.play();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch {
    // jsdom HTMLMediaElement.play is unimplemented; ignore.
  }
};
