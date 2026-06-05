import { For, type Component } from 'solid-js';
import { useUserPrefs } from '../../../UserPrefsContext';
import { AUTO_STOP_MODES, autoStopLabel } from '../../../autoStop';

/** One-line explanation of each mode, shown under the selector. */
const AUTO_STOP_HINTS: Record<string, string> = {
  auto: 'Stop on weight with a scale, otherwise on volume.',
  weight: 'Stop at the target yield. Needs a scale connected.',
  volume: 'Stop at the target volume. Only with no scale connected.',
  off: 'Never auto-stop — ends on the profile or a manual stop.',
};

/**
 * Brewing subsection — the global default auto-stop mode. This is the default
 * applied to every shot; the prep card can override it per shot (and there
 * only offers the modes that can actually fire given the live scale state).
 */
export const BrewingSection: Component = () => {
  const prefs = useUserPrefs();

  return (
    <div class="settings-section-stack">
      <section class="settings-section" aria-labelledby="brewing-autostop-heading">
        <h2 id="brewing-autostop-heading">Auto-stop (default)</h2>
        <div
          class="settings-radio-row"
          role="radiogroup"
          aria-label="Default auto-stop mode"
        >
          <For each={AUTO_STOP_MODES}>
            {(mode) => (
              <label class="settings-radio">
                <input
                  type="radio"
                  name="auto-stop-mode"
                  value={mode}
                  checked={prefs.autoStopMode() === mode}
                  onChange={() => prefs.setAutoStopMode(mode)}
                />
                <span>{autoStopLabel(mode)}</span>
              </label>
            )}
          </For>
        </div>
        <p class="settings-field__hint" data-testid="auto-stop-hint">
          {AUTO_STOP_HINTS[prefs.autoStopMode()]}
        </p>
      </section>
    </div>
  );
};
