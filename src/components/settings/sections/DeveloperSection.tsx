import { Show, createSignal, type Component } from 'solid-js';
import { useUserPrefs } from '../../../UserPrefsContext';
import { LOG_LEVELS, type LogLevel } from '../../../debugLog';
import { api } from '../../../api';
import { BUILD_INFO, buildInfoLine } from '../../../buildInfo';

type CopyState = 'idle' | 'copying' | 'copied' | 'empty' | 'error';

const COPY_LABEL: Record<CopyState, string> = {
  idle: 'Copy device log',
  copying: 'Fetching…',
  copied: 'Copied ✓',
  empty: 'No log captured',
  error: 'Fetch failed',
};

/**
 * Developer tools (Settings → About → Developer). One section card titled
 * "Developer" with three subsections: Build identity, Logging (level picker +
 * copy of the gateway's captured console log), and a Reset that clears all
 * locally-stored skin state for a fresh-install-like start.
 */
export const DeveloperSection: Component = () => {
  const prefs = useUserPrefs();
  const [copyState, setCopyState] = createSignal<CopyState>('idle');
  const [confirmingReset, setConfirmingReset] = createSignal(false);

  // Pull the gateway's captured WebView console log (this skin's console.*
  // output, ~1 MB of the current session) and copy it out. The gateway is the
  // single sink — there's no in-app buffer. On a real gateway this is the full
  // session; in dev the skin runs in a browser (not the gateway's WebView) so
  // the file is empty — use the browser devtools console there instead.
  const copyLog = async () => {
    setCopyState('copying');
    try {
      const logText = await api.webviewLogs();
      if (!logText.trim()) {
        setCopyState('empty');
      } else {
        // Prepend the build identity so a pasted log is self-identifying.
        const text = `${buildInfoLine()}\n\n${logText}`;
        // Echo to the console too — clipboard is unavailable over plain http
        // (the gateway isn't https), so this guarantees the log is reachable.
        // eslint-disable-next-line no-console
        console.log(text);
        await navigator.clipboard?.writeText(text).catch(() => {
          /* console fallback above */
        });
        setCopyState('copied');
      }
    } catch {
      setCopyState('error');
    }
    setTimeout(() => setCopyState('idle'), 2000);
  };

  const resetData = () => {
    const keys = Object.keys(localStorage).filter((k) =>
      k.startsWith('starter-skin.'),
    );
    keys.forEach((k) => localStorage.removeItem(k));
    location.reload();
  };

  return (
    <section class="settings-section" aria-labelledby="dev-heading">
      <h2 id="dev-heading">Developer</h2>

      <div class="settings-subsection" aria-labelledby="dev-build-heading">
        <h3 class="settings-subheading" id="dev-build-heading">Build</h3>
        <dl class="dev-build" data-testid="dev-build">
          <dt>Version</dt>
          <dd data-testid="dev-build-version">{BUILD_INFO.version}</dd>
          <dt>Commit</dt>
          <dd data-testid="dev-build-commit">{BUILD_INFO.gitHash}</dd>
          <dt>Built</dt>
          <dd data-testid="dev-build-time">{BUILD_INFO.buildTime}</dd>
        </dl>
      </div>

      <div class="settings-subsection" aria-labelledby="dev-logging-heading">
        <h3 class="settings-subheading" id="dev-logging-heading">Logging</h3>
        <label class="settings-field">
          <span class="settings-field__label">Log level</span>
          <select
            class="settings-select"
            data-testid="pref-log-level"
            value={prefs.logLevel()}
            onChange={(e) =>
              prefs.setLogLevel(e.currentTarget.value as LogLevel)
            }
          >
            {LOG_LEVELS.map((level) => (
              <option value={level}>{level}</option>
            ))}
          </select>
        </label>
        <p class="settings-help">
          Logs flow events to the console. Higher levels are chattier:{' '}
          <code>info</code> (default) keeps the session narrative;{' '}
          <code>debug</code>/<code>trace</code> add the play-by-play;{' '}
          <code>silent</code> turns logging off. On the machine these are
          captured by the gateway — “Copy device log” fetches that capture (the
          current session). In dev there's no gateway capture; use the browser
          devtools console.
        </p>
        <div class="dev-actions">
          <button
            type="button"
            class="btn"
            data-testid="copy-debug-log"
            disabled={copyState() === 'copying'}
            onClick={copyLog}
          >
            {COPY_LABEL[copyState()]}
          </button>
        </div>
      </div>

      <div class="settings-subsection" aria-labelledby="dev-reset-heading">
        <h3 class="settings-subheading" id="dev-reset-heading">Reset</h3>
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
      </div>
    </section>
  );
};
