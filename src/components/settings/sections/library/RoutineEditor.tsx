import {
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createResource,
  createSignal,
  type Component,
} from 'solid-js';
import {
  STEP_TYPES,
  routineStep,
  formatStepType,
  type Routine,
  type Recipe,
  type StepType,
} from '../../../../domain';
import { useRepositories } from '../../../../RepositoriesContext';

export interface RoutineEditorProps {
  routineId: string;
  /** Called after a successful delete; the sheet wrapper closes itself. */
  onClose: () => void;
}

/**
 * Routine editor.
 *
 * Auto-save semantics: every edit (name, add/remove/reorder step) writes
 * through to the repository immediately. The local resource refetches
 * after each write so the UI reflects persisted state, and consumers of
 * the parent list see fresh data on return (see RoutinesSection.refetch).
 *
 * Reorder uses up/down arrows rather than drag-and-drop — accessible,
 * keyboard-reachable, and no extra dependencies. The first row's `↑` and
 * last row's `↓` render disabled. Stable per-step ids survive reorders;
 * Recipe overrides keyed by those ids remain aligned.
 *
 * Step removal leaves any Recipe overrides for the removed step in place
 * as orphan keys (harmless — no step id collides with them). A separate
 * GC pass can clean those up later if it ever matters.
 *
 * Delete flow:
 *   - Always confirms first (inline panel, no native dialog)
 *   - If any Recipe references this Routine, the confirm panel lists the
 *     blockers and shows an opt-in "Also delete these N Recipes" checkbox.
 *     The Delete button is disabled until the checkbox is ticked; clicking
 *     it cascades — every referencing Recipe is deleted before the Routine.
 */
export const RoutineEditor: Component<RoutineEditorProps> = (p) => {
  const repos = useRepositories();
  const [routine, { refetch: refetchRoutine }] = createResource(
    () => p.routineId,
    (id) => repos.routines.get(id),
  );
  const [recipes] = createResource<Recipe[]>(() => repos.recipes.list());
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);
  const [cascadeAcknowledged, setCascadeAcknowledged] = createSignal(false);
  const [showStepPicker, setShowStepPicker] = createSignal(false);

  const referencingRecipes = createMemo<Recipe[]>(() =>
    (recipes() ?? []).filter((r) => r.routineId === p.routineId),
  );

  const saveRoutine = async (next: Routine) => {
    await repos.routines.update(next);
    refetchRoutine();
  };

  const handleRename = (raw: string) => {
    const next = raw.trim();
    const b = routine();
    if (!b || !next || b.name === next) return;
    void saveRoutine({ ...b, name: next });
  };

  const moveStep = (id: string, direction: -1 | 1) => {
    const b = routine();
    if (!b) return;
    const idx = b.steps.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const target = idx + direction;
    if (target < 0 || target >= b.steps.length) return;
    const steps = [...b.steps];
    [steps[idx], steps[target]] = [steps[target]!, steps[idx]!];
    void saveRoutine({ ...b, steps });
  };

  const removeStep = (id: string) => {
    const b = routine();
    if (!b) return;
    void saveRoutine({ ...b, steps: b.steps.filter((s) => s.id !== id) });
  };

  const addStep = (type: StepType) => {
    const b = routine();
    if (!b) return;
    setShowStepPicker(false);
    void saveRoutine({ ...b, steps: [...b.steps, routineStep(type, {})] });
  };

  const handleDelete = async () => {
    const blockers = referencingRecipes();
    if (blockers.length > 0) {
      // Cascade path: only proceed when the user has explicitly opted in
      // via the checkbox. UI also disables the button — defensive guard.
      if (!cascadeAcknowledged()) return;
      await Promise.all(blockers.map((r) => repos.recipes.delete(r.id)));
    }
    await repos.routines.delete(p.routineId);
    p.onClose();
  };

  const dismissDeletePanel = () => {
    setConfirmingDelete(false);
    setCascadeAcknowledged(false);
  };

  const usageHint = (): string => {
    const n = referencingRecipes().length;
    if (n === 0) return 'No Recipes use this Routine yet.';
    if (n === 1) return '1 Recipe uses this Routine — edits propagate.';
    return `${n} Recipes use this Routine — edits propagate.`;
  };

  return (
    <div class="settings-section-stack" data-testid="routine-editor">
      <h2 class="routine-editor__title">Edit Routine</h2>

      <Switch>
        <Match when={routine.loading}>
          <p class="muted">loading…</p>
        </Match>
        <Match when={routine() === null}>
          <p class="muted" role="alert">
            routine not found
          </p>
        </Match>
        <Match when={routine()}>
          {(b) => (
            <>
              <section class="settings-section">
                <h3>Name</h3>
                <input
                  type="text"
                  class="routine-editor__name"
                  value={b().name}
                  aria-label="Routine name"
                  data-testid="routine-name-input"
                  onChange={(e) => handleRename(e.currentTarget.value)}
                />
              </section>

              <section class="settings-section">
                <h3>Steps</h3>
                <p class="settings-help" data-testid="routine-usage-hint">
                  {usageHint()}
                </p>
                <Show
                  when={b().steps.length > 0}
                  fallback={<p class="muted">no steps yet — add one below</p>}
                >
                  <ol class="library-list" data-testid="routine-steps-list">
                    <For each={b().steps}>
                      {(s, i) => (
                        <li
                          class="library-list__row routine-editor__step-row"
                          data-testid={`routine-step-${s.id}`}
                        >
                          <div class="routine-editor__step-reorder">
                            <button
                              type="button"
                              class="icon-btn icon-btn--compact"
                              aria-label={`Move step ${i() + 1} up`}
                              data-testid={`step-up-${s.id}`}
                              disabled={i() === 0}
                              onClick={() => moveStep(s.id, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              class="icon-btn icon-btn--compact"
                              aria-label={`Move step ${i() + 1} down`}
                              data-testid={`step-down-${s.id}`}
                              disabled={i() === b().steps.length - 1}
                              onClick={() => moveStep(s.id, 1)}
                            >
                              ↓
                            </button>
                          </div>
                          <span class="routine-editor__step-name">
                            {i() + 1}. {formatStepType(s.type)}
                          </span>
                          <button
                            type="button"
                            class="icon-btn icon-btn--compact"
                            aria-label={`Remove step ${i() + 1}`}
                            data-testid={`step-remove-${s.id}`}
                            onClick={() => removeStep(s.id)}
                          >
                            ×
                          </button>
                        </li>
                      )}
                    </For>
                  </ol>
                </Show>

                <Show
                  when={showStepPicker()}
                  fallback={
                    <button
                      type="button"
                      class="btn routine-editor__add-step-btn"
                      data-testid="open-add-step"
                      onClick={() => setShowStepPicker(true)}
                    >
                      + Add step
                    </button>
                  }
                >
                  <div
                    class="routine-editor__step-picker"
                    data-testid="step-picker"
                    role="group"
                    aria-label="Choose a step type to add"
                  >
                    <For each={STEP_TYPES}>
                      {(t) => (
                        <button
                          type="button"
                          class="btn"
                          data-testid={`add-step-${t}`}
                          onClick={() => addStep(t)}
                        >
                          {formatStepType(t)}
                        </button>
                      )}
                    </For>
                    <button
                      type="button"
                      class="btn routine-editor__step-picker-cancel"
                      onClick={() => setShowStepPicker(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </Show>
              </section>

              <section class="settings-section">
                <h3>Delete</h3>
                <Show
                  when={confirmingDelete()}
                  fallback={
                    <button
                      type="button"
                      class="btn btn--danger"
                      data-testid="delete-routine-button"
                      onClick={() => setConfirmingDelete(true)}
                    >
                      Delete routine
                    </button>
                  }
                >
                  <Show
                    when={referencingRecipes().length === 0}
                    fallback={
                      <div
                        class="routine-editor__delete-blocked"
                        data-testid="delete-blocked"
                      >
                        <p>
                          Delete "{b().name}"?{' '}
                          {referencingRecipes().length === 1
                            ? '1 Recipe uses'
                            : `${referencingRecipes().length} Recipes use`}{' '}
                          this Routine:
                        </p>
                        <ul>
                          <For each={referencingRecipes()}>
                            {(r) => <li>{r.name}</li>}
                          </For>
                        </ul>
                        <label class="routine-editor__cascade-ack">
                          <input
                            type="checkbox"
                            data-testid="cascade-ack-checkbox"
                            checked={cascadeAcknowledged()}
                            onChange={(e) =>
                              setCascadeAcknowledged(e.currentTarget.checked)
                            }
                          />
                          <span>
                            Also delete{' '}
                            {referencingRecipes().length === 1
                              ? 'this Recipe'
                              : `these ${referencingRecipes().length} Recipes`}
                          </span>
                        </label>
                        <div class="routine-editor__button-row">
                          <button
                            type="button"
                            class="btn btn--danger"
                            data-testid="confirm-cascade-delete-button"
                            disabled={!cascadeAcknowledged()}
                            onClick={handleDelete}
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            class="btn"
                            onClick={dismissDeletePanel}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    }
                  >
                    <div
                      class="routine-editor__delete-confirm"
                      data-testid="delete-confirm"
                    >
                      <p>Delete "{b().name}"? This can't be undone.</p>
                      <div class="routine-editor__button-row">
                        <button
                          type="button"
                          class="btn btn--danger"
                          data-testid="confirm-delete-button"
                          onClick={handleDelete}
                        >
                          Yes, delete
                        </button>
                        <button
                          type="button"
                          class="btn"
                          onClick={dismissDeletePanel}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </Show>
                </Show>
              </section>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
};
