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
import type { Routine, Recipe } from '../../../../domain';
import { useRepositories } from '../../../../RepositoriesContext';
import { DebouncedNumberField } from './DebouncedNumberField';
import { PickerDialog } from '../../../PickerDialog';
import { ProfilePicker } from './ProfilePicker';
import { BeanPicker } from './BeanPicker';
import { api, type Bean, type ProfileRecord } from '../../../../api';

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
  /** Bean-list fetcher seam for the picker (defaults to `api.beans({})`). */
  loadBeans?: () => Promise<Bean[]>;
  /** Single-bean fetcher for the collapsed "selected bean" row. Returns null
   *  when the id no longer resolves (deleted / gateway offline). */
  loadBeanById?: (id: string) => Promise<Bean | null>;
}

/**
 * Recipe editor (Phase 4a — basics).
 *
 * Fields covered:
 *   - Name (auto-save on change, mirrors RoutineEditor)
 *   - Routine reference (a select of visible Routines; user can re-target)
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
  const [routines] = createResource(repos.revision, () =>
    repos.routines.list(),
  );
  const [pitchers] = createResource(repos.revision, () =>
    repos.pitchers.list(),
  );
  const visibleRoutines = (): Routine[] =>
    (routines() ?? []).filter((b) => !b.hidden);
  const parentRoutine = (): Routine | undefined => {
    const r = recipe();
    if (!r) return undefined;
    return (routines() ?? []).find((b) => b.id === r.routineId);
  };
  const parentStepSequence = (): string => {
    const steps = parentRoutine()?.steps ?? [];
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

  const [beanDialogOpen, setBeanDialogOpen] = createSignal(false);

  // Resolve the recipe's chosen bean for the collapsed field row. Resolves
  // archived beans too (GET /beans/{id} ignores `archived`), so a recipe
  // pointing at a retired bean still shows "Roaster — Name" (with a tag)
  // rather than "missing". Null only on real failure (deleted / offline).
  const loadBeanById = (id: string): Promise<Bean | null> =>
    (p.loadBeanById ?? ((x) => api.beanById(x).catch(() => null)))(id);
  const [selectedBean] = createResource<Bean | null, string>(
    () => recipe()?.beanId,
    (id) => loadBeanById(id),
  );

  const handleBeanSelect = (beanId: string) => {
    const r = recipe();
    if (!r) return;
    setBeanDialogOpen(false);
    if (r.beanId === beanId) return;
    void saveRecipe({ ...r, beanId });
  };

  const handleBeanClear = () => {
    const r = recipe();
    if (!r || r.beanId === undefined) return;
    void saveRecipe({ ...r, beanId: undefined });
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

  const handleRoutineChange = (routineId: string) => {
    const r = recipe();
    if (!r || r.routineId === routineId) return;
    void saveRecipe({ ...r, routineId });
  };

  // The pitcher picker only matters when the routine actually steams.
  const hasSteamStep = (): boolean =>
    (parentRoutine()?.steps ?? []).some((s) => s.type === 'steam');

  const handlePitcherChange = (value: string) => {
    const r = recipe();
    if (!r) return;
    const pitcherId = value === '' ? undefined : value;
    if (r.pitcherId === pitcherId) return;
    void saveRecipe({ ...r, pitcherId });
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
      <h2 class="routine-editor__title">Edit Recipe</h2>

      <Switch>
        {/* Only on the *initial* load — `.latest` stays defined through a
            refetch, so a debounced auto-save doesn't unmount the form (which
            would blur the focused field and close the keypad). */}
        <Match when={recipe.loading && !recipe.latest}>
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
                  class="routine-editor__name"
                  value={r().name}
                  aria-label="Recipe name"
                  data-testid="recipe-name-input"
                  onChange={(e) => handleRename(e.currentTarget.value)}
                />
              </section>

              <section class="settings-section">
                <h3>Routine</h3>
                <p class="settings-help">
                  Which Routine this Recipe brews — re-target to inherit a
                  different step sequence.
                </p>
                {/*
                  Defer the select until `routines` has resolved.
                  Mounting the select against an empty/partial option list
                  and then swapping in real options later leaves the
                  browser holding on to the previously-selected fallback
                  option's index, even when the new option has
                  `selected` set — the editor would render with the first
                  routine selected instead of the Recipe's true parent.
                */}
                <Show
                  when={!routines.loading}
                  fallback={<p class="muted">loading routines…</p>}
                >
                  <select
                    class="recipe-editor__routine-select"
                    aria-label="Routine"
                    data-testid="recipe-routine-select"
                    value={r().routineId}
                    onChange={(e) =>
                      handleRoutineChange(e.currentTarget.value)
                    }
                  >
                    <For each={visibleRoutines()}>
                      {(b) => <option value={b.id}>{b.name}</option>}
                    </For>
                    <Show
                      when={
                        !visibleRoutines().some(
                          (b) => b.id === r().routineId,
                        )
                      }
                    >
                      {/* Keep the current value selectable even if it's a hidden / missing Routine. */}
                      <option value={r().routineId}>
                        {parentRoutine()
                          ? `${parentRoutine()!.name} (hidden)`
                          : `(missing routine — ${r().routineId})`}
                      </option>
                    </Show>
                  </select>
                </Show>
                <p
                  class="recipe-editor__routine-sequence"
                  data-testid="recipe-routine-sequence"
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

              <Show when={hasSteamStep()}>
                <section class="settings-section" data-testid="recipe-pitcher-section">
                  <h3>Pitcher</h3>
                  <p class="settings-help">
                    Which milk pitcher this recipe steams with. The pitcher's
                    steam settings are applied at brew time. Manage pitchers in
                    Library → Steam.
                  </p>
                  <Show
                    when={!pitchers.loading}
                    fallback={<p class="muted">loading pitchers…</p>}
                  >
                    <select
                      class="recipe-editor__routine-select"
                      aria-label="Pitcher"
                      data-testid="recipe-pitcher-select"
                      value={r().pitcherId ?? ''}
                      onChange={(e) => handlePitcherChange(e.currentTarget.value)}
                    >
                      <option value="">No pitcher (use machine default)</option>
                      <For each={pitchers() ?? []}>
                        {(pt) => (
                          <option value={pt.id}>
                            {pt.name} — {pt.capacityMl} mL
                          </option>
                        )}
                      </For>
                      <Show
                        when={
                          r().pitcherId &&
                          !(pitchers() ?? []).some((pt) => pt.id === r().pitcherId)
                        }
                      >
                        {/* Keep a dangling reference selectable + visible. */}
                        <option value={r().pitcherId}>
                          (missing pitcher — {r().pitcherId})
                        </option>
                      </Show>
                    </select>
                  </Show>
                </section>
              </Show>

              <section class="settings-section">
                <h3>Brewing</h3>
                <p class="settings-help">
                  Which bean this recipe is dialled in for. Manage beans in
                  Library → Beans.
                </p>
                <BeanFieldRow
                  selectedId={r().beanId}
                  selectedBean={() => selectedBean() ?? null}
                  loading={selectedBean.loading}
                  onOpen={() => setBeanDialogOpen(true)}
                  onClear={handleBeanClear}
                />
                <div class="recipe-editor__field-row recipe-editor__field-row--stack">
                  <label class="recipe-editor__field">
                    <span class="recipe-editor__field-label">Dose</span>
                    <DebouncedNumberField
                      value={r().doseGrams}
                      onCommit={handleDoseCommit}                      min={0}
                      step={1}
                      decimal
                      steppers
                      unit="g"
                      recentsKey="dose"
                      ariaLabel="Dose"
                      testId="recipe-dose-input"
                      debounceMs={p.debounceMs}
                      class="step-field__input"
                    />                  </label>
                  <label class="recipe-editor__field">
                    <span class="recipe-editor__field-label">
                      Grinder setting
                    </span>
                    <DebouncedNumberField
                      value={r().grinderSetting}
                      onCommit={handleGrinderSettingCommit}
                      placeholder="—"
                      step={1}
                      decimal
                      steppers
                      recentsKey="grinder"
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
                      onCommit={handleTargetYieldCommit}                      min={0}
                      step={1}
                      decimal
                      steppers
                      unit="g"
                      recentsKey="yield"
                      ariaLabel="Target yield"
                      testId="recipe-target-yield-input"
                      debounceMs={p.debounceMs}
                      class="step-field__input"
                    />                  </label>
                  <label class="recipe-editor__field">
                    <span class="recipe-editor__field-label">
                      Target volume
                    </span>
                    <DebouncedNumberField
                      value={r().targetVolumeMl}
                      onCommit={handleTargetVolumeCommit}                      min={0}
                      step={1}
                      steppers
                      unit="mL"
                      recentsKey="volume"
                      ariaLabel="Target volume"
                      testId="recipe-target-volume-input"
                      debounceMs={p.debounceMs}
                      class="step-field__input"
                    />                  </label>
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
                    <span class="recipe-editor__stub-label">Grinder</span>
                    <span class="recipe-editor__stub-note">
                      Library not built yet
                    </span>
                  </li>
                </ul>
              </section>

              {/* Low-emphasis management toggle — the primary affordance is
                  the eye on each Library row. Sits just above Delete (the
                  other "what to do with this recipe" action) but as a
                  reversible switch, not a destructive button. */}
              <label
                class="settings-checkbox recipe-editor__hide-toggle"
                data-testid="recipe-hide-toggle"
              >
                <input
                  type="checkbox"
                  data-testid="recipe-hide-from-home"
                  checked={!!r().hidden}
                  onChange={(e) =>
                    void saveRecipe({ ...r(), hidden: e.currentTarget.checked })
                  }
                />
                <span>Hide from the home screen</span>
              </label>

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
                    class="routine-editor__delete-confirm"
                    data-testid="delete-confirm"
                  >
                    <p>Delete "{r().name}"? This can't be undone.</p>
                    <div class="routine-editor__button-row">
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
              <PickerDialog
                open={beanDialogOpen()}
                onClose={() => setBeanDialogOpen(false)}
                title="Choose a bean"
                description="Beans stored on the machine. Pick the one this recipe is for."
                testId="recipe-bean-dialog"
              >
                <BeanPicker
                  selectedId={r().beanId}
                  onSelect={handleBeanSelect}
                  onCancel={() => setBeanDialogOpen(false)}
                  loadBeans={p.loadBeans}
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

interface BeanFieldRowProps {
  selectedId: string | undefined;
  selectedBean: () => Bean | null;
  loading: boolean;
  onOpen: () => void;
  onClear: () => void;
}

/**
 * Collapsed display for the Recipe's chosen bean — mirrors ProfileFieldRow.
 * Resolves archived beans (shows an "archived" tag) so a retired pick still
 * reads as the bean, not "missing"; only a truly unresolvable id falls back
 * to the bare-id hint.
 */
const BeanFieldRow: Component<BeanFieldRowProps> = (p) => {
  const hasId = (): boolean => !!p.selectedId;
  const label = (): string => {
    const b = p.selectedBean();
    if (b) return `${b.roaster} — ${b.name}`;
    if (p.loading) return 'Loading…';
    return `(missing bean — ${p.selectedId})`;
  };
  return (
    <div
      class="recipe-editor__profile-field"
      data-testid="recipe-editor-bean-field"
    >
      <button
        type="button"
        class="recipe-editor__profile-button"
        data-testid="recipe-bean-open"
        aria-haspopup="dialog"
        onClick={p.onOpen}
      >
        <Show
          when={hasId()}
          fallback={
            <span class="recipe-editor__profile-empty">
              No bean selected — tap to choose
            </span>
          }
        >
          <span class="recipe-editor__profile-title">
            {label()}
            <Show when={p.selectedBean()?.archived}>
              <span class="bean-tree__badge bean-tree__badge--muted">
                archived
              </span>
            </Show>
          </span>
        </Show>
        <span class="recipe-editor__profile-chevron" aria-hidden="true">
          ›
        </span>
      </button>
      <Show when={hasId()}>
        <button
          type="button"
          class="recipe-editor__profile-clear"
          data-testid="recipe-bean-clear"
          aria-label="Clear selected bean"
          onClick={p.onClear}
        >
          ×
        </button>
      </Show>
    </div>
  );
};
