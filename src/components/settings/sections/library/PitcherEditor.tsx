import {
  Match,
  Switch,
  Show,
  createResource,
  createSignal,
  type Component,
} from 'solid-js';
import type { Pitcher } from '../../../../domain';
import { useRepositories } from '../../../../RepositoriesContext';
import { DebouncedNumberField } from './DebouncedNumberField';
import { DebouncedSliderField } from '../../DebouncedSliderField';

export interface PitcherEditorProps {
  pitcherId: string;
  onClose: () => void;
  /** Debounce override for tests. */
  debounceMs?: number;
}

/**
 * Pitcher editor — name + capacity identity plus the steam parameters
 * (duration / temperature / flow) the brew runtime applies when this pitcher
 * is chosen. Auto-saves each field on change, mirroring RecipeEditor.
 */
export const PitcherEditor: Component<PitcherEditorProps> = (p) => {
  const repos = useRepositories();
  const [pitcher, { refetch }] = createResource(
    () => p.pitcherId,
    (id) => repos.pitchers.get(id),
  );
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);

  const save = async (next: Pitcher) => {
    await repos.pitchers.update(next);
    refetch();
  };

  const handleRename = (raw: string) => {
    const name = raw.trim();
    const cur = pitcher();
    if (!cur || !name || cur.name === name) return;
    void save({ ...cur, name });
  };

  // Numeric fields share one shape: ignore undefined (a cleared field keeps
  // the prior value — these are all required for a usable pitcher).
  const commit = (key: keyof Pitcher, value: number | undefined) => {
    const cur = pitcher();
    if (!cur || value == null) return;
    void save({ ...cur, [key]: value });
  };

  const handleDelete = async () => {
    await repos.pitchers.delete(p.pitcherId);
    p.onClose();
  };

  return (
    <div class="settings-section-stack" data-testid="pitcher-editor">
      <h2 class="routine-editor__title">Edit Pitcher</h2>

      <Switch>
        <Match when={pitcher.loading}>
          <p class="muted">loading…</p>
        </Match>
        <Match when={pitcher() === null}>
          <p class="muted" role="alert">
            pitcher not found
          </p>
        </Match>
        <Match when={pitcher()}>
          {(pt) => (
            <>
              <section class="settings-section">
                <h3>Name</h3>
                <input
                  type="text"
                  class="routine-editor__name"
                  value={pt().name}
                  aria-label="Pitcher name"
                  data-testid="pitcher-name-input"
                  onChange={(e) => handleRename(e.currentTarget.value)}
                />
              </section>

              <section class="settings-section">
                <h3>Capacity</h3>
                <p class="settings-help">
                  Nominal jug size — labelling only; it doesn't change how the
                  machine steams.
                </p>
                <label class="recipe-editor__field">
                  <span class="recipe-editor__field-label">Capacity</span>
                  <DebouncedNumberField
                    value={pt().capacityMl}
                    onCommit={(v) => commit('capacityMl', v)}                    min={0}
                    step={10}
                    steppers
                    unit="mL"
                    ariaLabel="Capacity (millilitres)"
                    testId="pitcher-capacity-input"
                    debounceMs={p.debounceMs}
                    class="step-field__input"
                  />                </label>
              </section>

              <section class="settings-section">
                <h3>Steam parameters</h3>
                <p class="settings-help">
                  Applied to the machine when a recipe using this pitcher
                  steams. Duration is the auto-stop time.
                </p>
                <div class="settings-field settings-field--stack">
                  <label
                    class="settings-field__label"
                    for="pitcher-duration-input"
                  >
                    Duration
                  </label>
                  <DebouncedSliderField
                    testId="pitcher-duration-input"
                    value={pt().steamDurationSec}
                    onCommit={(v) => commit('steamDurationSec', v)}
                    min={5}
                    max={120}
                    step={1}
                    ariaLabel="Steam duration (seconds)"
                    formatValue={(v) => `${v.toFixed(0)} s`}
                    debounceMs={p.debounceMs}
                  />
                </div>
                <div class="settings-field settings-field--stack">
                  <label class="settings-field__label" for="pitcher-temp-input">
                    Temperature
                  </label>
                  <DebouncedSliderField
                    testId="pitcher-temp-input"
                    value={pt().steamTempC}
                    onCommit={(v) => commit('steamTempC', v)}
                    min={130}
                    max={170}
                    step={1}
                    ariaLabel="Steam temperature (degrees Celsius)"
                    formatValue={(v) => `${v.toFixed(0)} °C`}
                    debounceMs={p.debounceMs}
                  />
                </div>
                <div class="settings-field settings-field--stack">
                  <label class="settings-field__label" for="pitcher-flow-input">
                    Flow
                  </label>
                  <DebouncedSliderField
                    testId="pitcher-flow-input"
                    value={pt().steamFlow}
                    onCommit={(v) => commit('steamFlow', v)}
                    min={0.4}
                    max={2}
                    step={0.1}
                    ariaLabel="Steam flow (millilitres per second)"
                    formatValue={(v) => `${v.toFixed(1)} mL/s`}
                    debounceMs={p.debounceMs}
                  />
                </div>
              </section>

              <section class="settings-section">
                <h3>Delete</h3>
                <Show
                  when={confirmingDelete()}
                  fallback={
                    <button
                      type="button"
                      class="btn btn--danger"
                      data-testid="delete-pitcher-button"
                      onClick={() => setConfirmingDelete(true)}
                    >
                      Delete pitcher
                    </button>
                  }
                >
                  <div
                    class="routine-editor__delete-confirm"
                    data-testid="delete-confirm"
                  >
                    <p>Delete "{pt().name}"? This can't be undone.</p>
                    <div class="routine-editor__button-row">
                      <button
                        type="button"
                        class="btn btn--danger"
                        data-testid="confirm-delete-pitcher-button"
                        onClick={handleDelete}
                      >
                        Yes, delete
                      </button>
                      <button
                        type="button"
                        class="btn"
                        onClick={() => setConfirmingDelete(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </Show>
              </section>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
};
