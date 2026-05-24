import {
  For,
  Match,
  Show,
  Switch,
  createResource,
  createSignal,
  type Component,
} from 'solid-js';
import { formatStepType } from '../../../../domain';
import type { Beverage, Recipe } from '../../../../domain';
import { useRepositories } from '../../../../RepositoriesContext';
import { DebouncedNumberField } from './DebouncedNumberField';

export interface RecipeEditorProps {
  recipeId: string;
  onClose: () => void;
  /** Debounce override for tests. */
  debounceMs?: number;
}

/**
 * Recipe editor (Phase 4a — basics).
 *
 * Fields covered:
 *   - Name (auto-save on change, mirrors BeverageEditor)
 *   - Beverage reference (a select of visible Beverages; user can re-target)
 *   - Dose-in weight (grams)
 *   - Grinder setting (number — the grinder library isn't built yet, so
 *     this is a bare number for now; once a Grinder library exists the
 *     setting will be paired with a Grinder reference)
 *
 * Out of scope here (will land in 4b / 4c / library work):
 *   - Per-step overrides UI
 *   - Detach action (clone-as-hidden + retarget)
 *   - Bean / Grinder / Profile picker rows — shown as disabled placeholders
 *
 * Storage shape stays the full Recipe interface; missing fields stay
 * undefined and propagate through the resolution chain unchanged.
 */
export const RecipeEditor: Component<RecipeEditorProps> = (p) => {
  const repos = useRepositories();
  const [recipe, { refetch: refetchRecipe }] = createResource(
    () => p.recipeId,
    (id) => repos.recipes.get(id),
  );
  // Pulls the full list (incl. hidden) so a recipe that points at a hidden
  // detach-clone can still resolve its parent's name + step sequence in
  // the header. The picker below filters visible ones for user selection.
  const [beverages] = createResource<Beverage[]>(() => repos.beverages.list());
  const visibleBeverages = (): Beverage[] =>
    (beverages() ?? []).filter((b) => !b.hidden);
  const parentBeverage = (): Beverage | undefined => {
    const r = recipe();
    if (!r) return undefined;
    return (beverages() ?? []).find((b) => b.id === r.beverageId);
  };
  const parentStepSequence = (): string => {
    const steps = parentBeverage()?.steps ?? [];
    if (steps.length === 0) return '(no steps yet)';
    return steps.map((s) => formatStepType(s.type)).join(' → ');
  };
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);

  const saveRecipe = async (next: Recipe) => {
    await repos.recipes.update(next);
    refetchRecipe();
  };

  const handleRename = (raw: string) => {
    const next = raw.trim();
    const r = recipe();
    if (!r || !next || r.name === next) return;
    void saveRecipe({ ...r, name: next });
  };

  const handleBeverageChange = (beverageId: string) => {
    const r = recipe();
    if (!r || r.beverageId === beverageId) return;
    void saveRecipe({ ...r, beverageId });
  };

  const handleDoseCommit = (g: number | undefined) => {
    const r = recipe();
    if (!r) return;
    void saveRecipe({ ...r, doseGrams: g });
  };

  const handleGrinderSettingCommit = (n: number | undefined) => {
    const r = recipe();
    if (!r) return;
    void saveRecipe({ ...r, grinderSetting: n });
  };

  const handleDelete = async () => {
    await repos.recipes.delete(p.recipeId);
    p.onClose();
  };

  return (
    <div class="settings-section-stack" data-testid="recipe-editor">
      <h2 class="beverage-editor__title">Edit Recipe</h2>

      <Switch>
        <Match when={recipe.loading}>
          <p class="muted">loading…</p>
        </Match>
        <Match when={recipe() === null}>
          <p class="muted" role="alert">
            recipe not found
          </p>
        </Match>
        <Match when={recipe()}>
          {(r) => (
            <>
              <section class="settings-section">
                <h3>Name</h3>
                <input
                  type="text"
                  class="beverage-editor__name"
                  value={r().name}
                  aria-label="Recipe name"
                  data-testid="recipe-name-input"
                  onChange={(e) => handleRename(e.currentTarget.value)}
                />
              </section>

              <section class="settings-section">
                <h3>Beverage</h3>
                <p class="settings-help">
                  Which Beverage this Recipe brews — re-target to inherit a
                  different step sequence.
                </p>
                {/*
                  Defer the select until `beverages` has resolved.
                  Mounting the select against an empty/partial option list
                  and then swapping in real options later leaves the
                  browser holding on to the previously-selected fallback
                  option's index, even when the new option has
                  `selected` set — the editor would render with the first
                  beverage selected instead of the Recipe's true parent.
                */}
                <Show
                  when={!beverages.loading}
                  fallback={<p class="muted">loading beverages…</p>}
                >
                  <select
                    class="recipe-editor__beverage-select"
                    aria-label="Beverage"
                    data-testid="recipe-beverage-select"
                    value={r().beverageId}
                    onChange={(e) =>
                      handleBeverageChange(e.currentTarget.value)
                    }
                  >
                    <For each={visibleBeverages()}>
                      {(b) => <option value={b.id}>{b.name}</option>}
                    </For>
                    <Show
                      when={
                        !visibleBeverages().some(
                          (b) => b.id === r().beverageId,
                        )
                      }
                    >
                      {/* Keep the current value selectable even if it's a hidden / missing Beverage. */}
                      <option value={r().beverageId}>
                        {parentBeverage()
                          ? `${parentBeverage()!.name} (hidden)`
                          : `(missing beverage — ${r().beverageId})`}
                      </option>
                    </Show>
                  </select>
                </Show>
                <p
                  class="recipe-editor__beverage-sequence"
                  data-testid="recipe-beverage-sequence"
                >
                  {parentStepSequence()}
                </p>
              </section>

              <section class="settings-section">
                <h3>Brewing</h3>
                <div class="recipe-editor__field-row">
                  <label class="recipe-editor__field">
                    <span class="recipe-editor__field-label">Dose</span>
                    <DebouncedNumberField
                      value={r().doseGrams}
                      onCommit={handleDoseCommit}
                      placeholder="g"
                      min={0}
                      step={0.1}
                      ariaLabel="Dose-in weight (grams)"
                      testId="recipe-dose-input"
                      debounceMs={p.debounceMs}
                      class="step-field__input"
                    />
                    <span class="step-field__unit">g</span>
                  </label>
                  <label class="recipe-editor__field">
                    <span class="recipe-editor__field-label">
                      Grinder setting
                    </span>
                    <DebouncedNumberField
                      value={r().grinderSetting}
                      onCommit={handleGrinderSettingCommit}
                      placeholder="—"
                      step={0.1}
                      ariaLabel="Grinder setting"
                      testId="recipe-grinder-setting-input"
                      debounceMs={p.debounceMs}
                      class="step-field__input"
                    />
                  </label>
                </div>
              </section>

              <section class="settings-section">
                <h3>Coming soon</h3>
                <ul class="recipe-editor__stubs">
                  <li>
                    <span class="recipe-editor__stub-label">Bean</span>
                    <span class="recipe-editor__stub-note">
                      Library not built yet
                    </span>
                  </li>
                  <li>
                    <span class="recipe-editor__stub-label">Grinder</span>
                    <span class="recipe-editor__stub-note">
                      Library not built yet
                    </span>
                  </li>
                  <li>
                    <span class="recipe-editor__stub-label">
                      Espresso profile
                    </span>
                    <span class="recipe-editor__stub-note">
                      Library not built yet
                    </span>
                  </li>
                </ul>
              </section>

              <section class="settings-section">
                <h3>Delete</h3>
                <Show
                  when={confirmingDelete()}
                  fallback={
                    <button
                      type="button"
                      class="btn btn--danger"
                      data-testid="delete-recipe-button"
                      onClick={() => setConfirmingDelete(true)}
                    >
                      Delete recipe
                    </button>
                  }
                >
                  <div
                    class="beverage-editor__delete-confirm"
                    data-testid="delete-confirm"
                  >
                    <p>Delete "{r().name}"? This can't be undone.</p>
                    <div class="beverage-editor__button-row">
                      <button
                        type="button"
                        class="btn btn--danger"
                        data-testid="confirm-delete-recipe-button"
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
