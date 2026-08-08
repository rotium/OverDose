import {
  Match,
  Switch,
  Show,
  createResource,
  createSignal,
  type Component,
} from 'solid-js';
import {
  VESSEL_CAPACITY_MAX_ML,
  VESSEL_CAPACITY_MIN_ML,
  VESSEL_FLOW_MAX,
  VESSEL_FLOW_MIN,
  type Vessel,
} from '../../../../domain';
import { useRepositories } from '../../../../RepositoriesContext';
import { DebouncedNumberField } from './DebouncedNumberField';
import { DebouncedSliderField } from '../../DebouncedSliderField';

export interface VesselEditorProps {
  vesselId: string;
  onClose: () => void;
  /** Debounce override for tests. */
  debounceMs?: number;
}

/**
 * Vessel editor — the size you pour into, plus how gently to pour. Auto-saves
 * each field on change, mirroring PitcherEditor.
 *
 * Only two parameters, because only two belong to a physical object. The pour
 * itself (volume and temperature) lives on the recipe's water step: a mug is a
 * mug whether it's holding a 150 mL americano at 85 °C or a 280 mL tea at 95 °C.
 */
export const VesselEditor: Component<VesselEditorProps> = (p) => {
  const repos = useRepositories();
  const [vessel, { refetch }] = createResource(
    () => p.vesselId,
    (id) => repos.vessels.get(id),
  );
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);

  const save = async (next: Vessel) => {
    await repos.vessels.update(next);
    refetch();
  };

  const handleRename = (raw: string) => {
    const name = raw.trim();
    const cur = vessel();
    if (!cur || !name || cur.name === name) return;
    void save({ ...cur, name });
  };

  // A cleared field keeps the prior value — both are required for a usable
  // vessel.
  const commit = (key: keyof Vessel, value: number | undefined) => {
    const cur = vessel();
    if (!cur || value == null) return;
    void save({ ...cur, [key]: value });
  };

  const handleDelete = async () => {
    await repos.vessels.delete(p.vesselId);
    p.onClose();
  };

  return (
    <div class="settings-section-stack" data-testid="vessel-editor">
      <h2 class="routine-editor__title">Edit Vessel</h2>

      <Switch>
        {/* Initial load only — `.latest` survives a refetch so a debounced
            auto-save doesn't unmount the form and close the keypad. */}
        <Match when={vessel.loading && !vessel.latest}>
          <p class="muted">loading…</p>
        </Match>
        <Match when={vessel() === null}>
          <p class="muted" role="alert">
            vessel not found
          </p>
        </Match>
        <Match when={vessel()}>
          {(v) => (
            <>
              <section class="settings-section">
                <h3>Name</h3>
                <p class="settings-help">
                  Name it for its size — "Small", "Cup", "Mug", "Teapot".
                </p>
                <input
                  type="text"
                  class="routine-editor__name"
                  value={v().name}
                  aria-label="Vessel name"
                  data-testid="vessel-name-input"
                  onChange={(e) => handleRename(e.currentTarget.value)}
                />
              </section>

              <section class="settings-section">
                <h3>Capacity</h3>
                <p class="settings-help">
                  How much you actually pour into it, not how much it holds to
                  the brim. Picking this vessel starts a pour here, and no step
                  can ask for more.
                </p>
                <label class="recipe-editor__field">
                  <span class="recipe-editor__field-label">Capacity</span>
                  <DebouncedNumberField
                    value={v().capacityMl}
                    onCommit={(x) => commit('capacityMl', x)}
                    min={VESSEL_CAPACITY_MIN_ML}
                    max={VESSEL_CAPACITY_MAX_ML}
                    step={10}
                    steppers
                    unit="mL"
                    ariaLabel="Capacity (millilitres)"
                    testId="vessel-capacity-input"
                    debounceMs={p.debounceMs}
                    class="step-field__input"
                  />
                </label>
              </section>

              <section class="settings-section">
                <h3>Flow</h3>
                <p class="settings-help">
                  How fast water goes in. A narrow neck wants a gentler pour;
                  a wide mug can take it fast.
                </p>
                <div class="settings-field settings-field--stack">
                  <label class="settings-field__label" for="vessel-flow-input">
                    Flow
                  </label>
                  <DebouncedSliderField
                    testId="vessel-flow-input"
                    value={v().flow}
                    onCommit={(x) => commit('flow', x)}
                    min={VESSEL_FLOW_MIN}
                    max={VESSEL_FLOW_MAX}
                    step={0.5}
                    ariaLabel="Hot water flow (millilitres per second)"
                    formatValue={(x) => `${x.toFixed(1)} mL/s`}
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
                      data-testid="delete-vessel-button"
                      onClick={() => setConfirmingDelete(true)}
                    >
                      Delete vessel
                    </button>
                  }
                >
                  <div
                    class="routine-editor__delete-confirm"
                    data-testid="delete-confirm"
                  >
                    <p>Delete "{v().name}"? This can't be undone.</p>
                    <div class="routine-editor__button-row">
                      <button
                        type="button"
                        class="btn btn--danger"
                        data-testid="confirm-delete-vessel-button"
                        onClick={handleDelete}
                      >
                        Yes, delete
                      </button>
                      <button
                        type="button"
                        class="btn"
                        data-testid="cancel-delete-vessel-button"
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
