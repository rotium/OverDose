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
import { PickerDialog } from '../../../PickerDialog';
import { ProfilePicker } from './ProfilePicker';
import { api, type ProfileRecord } from '../../../../api';

export interface RecipeEditorProps {
  recipeId: string;
  onClose: () => void;
  /** Debounce override for tests. */
  debounceMs?: number;
  /** Profile-list fetcher seam (defaults to `api.profiles({})`). Used by
   *  the dialog's ProfilePicker. Tests inject a fake to avoid the real
   *  gateway round-trip. */
  loadProfiles?: () => Promise<ProfileRecord[]>;
  /** Single-profile fetcher used to render the collapsed "selected
   *  profile" row. Returns null when the id no longer resolves (deleted /
   *  hidden / gateway unavailable) so the editor renders a graceful
   *  fallback instead of crashing the resource. Default mirrors that
   *  null-on-error contract. */
  loadProfileById?: (id: string) => Promise<ProfileRecord | null>;
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
  const [profileDialogOpen, setProfileDialogOpen] = createSignal(false);

  // Resolve the currently-selected profile so we can render its title in
  // the collapsed field. Keyed off the Recipe's `profileId`; refetches
  // when it changes. The fetcher resolves to `null` on any failure
  // (deleted, hidden, gateway offline) so we render a graceful "missing"
  // affordance rather than blowing up the resource.
  const loadProfileById = (id: string): Promise<ProfileRecord | null> =>
    (p.loadProfileById ?? ((x) => api.profileById(x).catch(() => null)))(id);
  const [selectedProfile] = createResource<ProfileRecord | null, string>(
    () => recipe()?.profileId,
    (id) => loadProfileById(id),
  );

  const handleProfileSelect = (profileId: string) => {
    const r = recipe();
    if (!r) return;
    setProfileDialogOpen(false);
    if (r.profileId === profileId) return;
    void saveRecipe({ ...r, profileId });
  };

  const handleProfileClear = () => {
    const r = recipe();
    if (!r || r.profileId === undefined) return;
    void saveRecipe({ ...r, profileId: undefined });
  };

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

  const handleTargetYieldCommit = (g: number | undefined) => {
    const r = recipe();
    if (!r) return;
    void saveRecipe({ ...r, targetYieldGrams: g });
  };

  const handleTargetVolumeCommit = (ml: number | undefined) => {
    const r = recipe();
    if (!r) return;
    void saveRecipe({ ...r, targetVolumeMl: ml });
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
                <h3>Espresso profile</h3>
                <p class="settings-help">
                  Which espresso profile the brew step uses. Profiles live
                  on the gateway; pick from the library.
                </p>
                <ProfileFieldRow
                  selectedId={r().profileId}
                  selectedProfile={() => selectedProfile() ?? null}
                  loading={selectedProfile.loading}
                  onOpen={() => setProfileDialogOpen(true)}
                  onClear={handleProfileClear}
                />
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
                  <label class="recipe-editor__field">
                    <span class="recipe-editor__field-label">
                      Target yield
                    </span>
                    <DebouncedNumberField
                      value={r().targetYieldGrams}
                      onCommit={handleTargetYieldCommit}
                      placeholder="g"
                      min={0}
                      step={0.1}
                      ariaLabel="Target yield (grams)"
                      testId="recipe-target-yield-input"
                      debounceMs={p.debounceMs}
                      class="step-field__input"
                    />
                    <span class="step-field__unit">g</span>
                  </label>
                  <label class="recipe-editor__field">
                    <span class="recipe-editor__field-label">
                      Target volume
                    </span>
                    <DebouncedNumberField
                      value={r().targetVolumeMl}
                      onCommit={handleTargetVolumeCommit}
                      placeholder="mL"
                      min={0}
                      step={1}
                      ariaLabel="Target volume (millilitres)"
                      testId="recipe-target-volume-input"
                      debounceMs={p.debounceMs}
                      class="step-field__input"
                    />
                    <span class="step-field__unit">mL</span>
                  </label>
                </div>
                <p class="settings-help">
                  Target yield stops the shot at this cup weight — needs a
                  connected scale. Target volume is the fallback stop used
                  when no scale is connected.
                </p>
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
              <PickerDialog
                open={profileDialogOpen()}
                onClose={() => setProfileDialogOpen(false)}
                title="Choose a profile"
                description="Espresso profiles loaded on the gateway."
                testId="recipe-profile-dialog"
                maxWidthPx={1100}
              >
                <ProfilePicker
                  selectedId={r().profileId}
                  onSelect={handleProfileSelect}
                  onCancel={() => setProfileDialogOpen(false)}
                  loadProfiles={p.loadProfiles}
                />
              </PickerDialog>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
};

interface ProfileFieldRowProps {
  selectedId: string | undefined;
  selectedProfile: () => ProfileRecord | null;
  loading: boolean;
  onOpen: () => void;
  onClear: () => void;
}

/**
 * Collapsed display for the Recipe's chosen profile. Clicking opens the
 * picker dialog. When a profileId is set but the gateway returns nothing
 * (deleted, hidden, or offline), we fall back to showing the bare id so
 * the user understands what's pinned and can re-pick. The clear button
 * is rendered alongside so a Recipe can be returned to the "no profile"
 * state without opening the dialog.
 */
const ProfileFieldRow: Component<ProfileFieldRowProps> = (p) => {
  const hasId = (): boolean => !!p.selectedId;
  const title = (): string => {
    const rec = p.selectedProfile();
    if (rec) return (rec.profile.title ?? '').trim() || '(untitled)';
    if (p.loading) return 'Loading…';
    return `(missing profile — ${p.selectedId})`;
  };
  return (
    <div
      class="recipe-editor__profile-field"
      data-testid="recipe-editor-profile-field"
    >
      <button
        type="button"
        class="recipe-editor__profile-button"
        data-testid="recipe-profile-open"
        aria-haspopup="dialog"
        onClick={p.onOpen}
      >
        <Show
          when={hasId()}
          fallback={
            <span class="recipe-editor__profile-empty">
              No profile selected — tap to choose
            </span>
          }
        >
          <span class="recipe-editor__profile-title">{title()}</span>
        </Show>
        <span class="recipe-editor__profile-chevron" aria-hidden="true">
          ›
        </span>
      </button>
      <Show when={hasId()}>
        <button
          type="button"
          class="recipe-editor__profile-clear"
          data-testid="recipe-profile-clear"
          aria-label="Clear selected profile"
          onClick={p.onClear}
        >
          ×
        </button>
      </Show>
    </div>
  );
};
