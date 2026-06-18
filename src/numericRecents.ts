/**
 * Recently-used numeric values, per semantic field key — the "quick-pick"
 * chips on the numeric keypad (Phase 2).
 *
 * Plain MRU: the last N distinct values for a key, newest first. Committing a
 * value moves it to the front (de-duplped) and drops the oldest past the cap.
 * Persisted in localStorage; starts empty and learns from use (no seeding).
 *
 * `recentsFor()` reads through a `version` signal so the keypad re-renders its
 * chips when a new value is pushed. Reads hit localStorage directly (a handful
 * of numbers — cheap), so there's no in-memory cache to keep in sync.
 */
import { createSignal } from 'solid-js';

const CAP = 5;
const PREFIX = 'overdose.recents.';

const load = (key: string): number[] => {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
      : [];
  } catch {
    return [];
  }
};

const [version, setVersion] = createSignal(0);

/** Reactive: the MRU values for `key`, newest first. */
export const recentsFor = (key: string): number[] => {
  version(); // subscribe — re-reads when pushRecent bumps the version
  return load(key);
};

/** Record a committed value: move-to-front, de-dupe, cap. */
export const pushRecent = (key: string, value: number): void => {
  if (!Number.isFinite(value)) return;
  const next = [value, ...load(key).filter((v) => v !== value)].slice(0, CAP);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(next));
  } catch {
    // ignore quota / disabled storage — recents are best-effort
  }
  setVersion((v) => v + 1);
};
