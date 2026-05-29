import {
  Show,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import { useUserPrefs } from '../../../UserPrefsContext';
import { clearDebugLog, debugLogSize, getDebugLog } from '../../../debugLog';
import { BUILD_INFO, buildInfoLine } from '../../../buildInfo';

/**
 * Developer tools (Settings → App → Developer). Debug logging toggle + copy /
 * clear of the in-app log buffer, and a "reset app data" that clears all
 * locally-stored skin state for a fresh-install-like start.
 */
export const DeveloperSection: Component = () => {
  const prefs = useUserPrefs();
  const [copied, setCopied] = createSignal(false);
  const [confirmingReset, setConfirmingReset] = createSignal(false);
  // Poll the buffer size so the count + disabled states stay live while the
  // tab is open (the buffer is a plain module, not a signal).
  const [size, setSize] = createSignal(debugLogSize());
  onMount(() => {
    const id = setInterval(() => setSize(debugLogSize()), 400);
    onCleanup(() => clearInterval(id));
  });

  const copyLog = async () => {
    // Prepend the build identity so a pasted log is self-identifying.
    const text = `${buildInfoLine()}\n\n${getDebugLog()}`;
    // Always echo to the console too — clipboard is unavailable over plain
    // http (the gateway isn't https), so this guarantees the log is reachable.
    // eslint-disable-next-line no-console
    console.log(text);
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* console fallback above */
    }
  };

  const clear = () => {
    clearDebugLog();
    setSize(0);
  };

  const resetData = () => {
    const keys = Object.keys(localStorage).filter((k) =>
      k.startsWith('starter-skin.'),
    );
    keys.forEach((k) => localStorage.removeItem(k));
    location.reload();
  };

  return (
    <div class="settings-section-stack">
      <section class="settings-section" aria-labelledby="dev-build-heading">
        <h2 id="dev-build-heading">Build</h2>
        <dl class="dev-build" data-testid="dev-build">
          <dt>Version</dt>
          <dd data-testid="dev-build-version">{BUILD_INFO.version}</dd>
          <dt>Commit</dt>
          <dd data-testid="dev-build-commit">{BUILD_INFO.gitHash}</dd>
          <dt>Built</dt>
          <dd data-testid="dev-build-time">{BUILD_INFO.buildTime}</dd>
        </dl>
      </section>

      <section class="settings-section" aria-labelledby="dev-logging-heading">
        <h2 id="dev-logging-heading">Logging</h2>
        <label class="settings-checkbox">
          <input
            type="checkbox"
            data-testid="pref-debug-logging"
            checked={prefs.debugLogging()}
            onChange={(e) => prefs.setDebugLogging(e.currentTarget.checked)}
          />
          <span>Enable debug logging</span>
        </label>
        <p class="settings-help">
          Logs machine state/activity transitions, steam-duration changes, and
          brew/steam-stop events to the browser console and an in-app buffer —
          so you can run a brew and copy the timeline afterwards instead of
          catching it live.
        </p>
        <div class="dev-actions">
          <button
            type="button"
            class="btn"
            data-testid="copy-debug-log"
            disabled={size() === 0}
            onClick={copyLog}
          >
            {copied() ? 'Copied ✓' : `Copy log (${size()})`}
          </button>
          <button
            type="button"
            class="btn"
            data-testid="clear-debug-log"
            disabled={size() === 0}
            onClick={clear}
          >
            Clear log
          </button>
        </div>
      </section>

      <section class="settings-section" aria-labelledby="dev-reset-heading">
        <h2 id="dev-reset-heading">Reset</h2>
        <p class="settings-help">
          Clears all locally-stored skin data — preferences, recipes, routines,
          and pitchers — then reloads, like a fresh install. Gateway data
          (profiles, shots) is not touched.
        </p>
        <Show
          when={confirmingReset()}
          fallback={
            <button
              type="button"
              class="btn btn--danger"
              data-testid="reset-app-data"
              onClick={() => setConfirmingReset(true)}
            >
              Reset app data…
            </button>
          }
        >
          <div class="routine-editor__delete-confirm" data-testid="reset-confirm">
            <p>Reset all skin data and reload? This can't be undone.</p>
            <div class="routine-editor__button-row">
              <button
                type="button"
                class="btn btn--danger"
                data-testid="confirm-reset-app-data"
                onClick={resetData}
              >
                Yes, reset
              </button>
              <button
                type="button"
                class="btn"
                onClick={() => setConfirmingReset(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </Show>
      </section>
    </div>
  );
};
