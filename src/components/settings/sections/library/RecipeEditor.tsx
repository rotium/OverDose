import {
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createResource,
  createSignal,
  type Accessor,
  type Component,
} from 'solid-js';
import { formatStepType } from '../../../../domain';
import {
  VESSEL_CAPACITY_MAX_ML,
  type Routine,
  type Recipe,
  type RoutineStep,
  type Vessel,
  type WaterConfig,
} from '../../../../domain';
import { clampVolumeToVessel } from '../../../../hotWater';
import {
  HOT_WATER_TEMP_MAX_C,
  HOT_WATER_TEMP_MIN_C,
} from '../../../../prefs';
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
  const [vessels] = createResource(repos.revision, () => repos.vessels.list());
  const [pitchers] = createResource(repos.revision, () =>
    repos.pitchers.list(),
  );
  const visibleRoutines = (): Routine[] =>
    (routines() ?? []).filter((b) => !b.hidden);
  // `.latest` deliberately, not `routines()`. The resource is sourced on
  // `repos.revision`, and saving a recipe bumps it — so on every auto-save the
  // fetcher re-runs and `routines()` is briefly undefined. Reading that would
  // collapse the step list to empty mid-edit and tear down the field the user
  // is typing into.
  const parentRoutine = (): Routine | undefined => {
    const r = recipe();
    if (!r) return undefined;
    return (routines.latest ?? []).find((b) => b.id === r.routineId);
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

  const handlePitcherChange = (value: string) => {
    const r = recipe();
    if (!r) return;
    const pitcherId = value === '' ? undefined : value;
    if (r.pitcherId === pitcherId) return;
    void saveRecipe({ ...r, pitcherId });
  };

  // Hot water is the first per-step config: unlike steam (one pitcher per
  // recipe, hence the flat Recipe.pitcherId), a recipe can pour water twice at
  // different settings — pre-warm the cup, brew, then dilute — so the vessel,
  // volume and temperature live on the step, in Recipe.overrides[stepId].
  const waterSteps = (): RoutineStep[] =>
    stepList().filter((s) => s.type === 'water');

  const waterCfg = (stepId: string): WaterConfig =>
    (recipe()?.overrides?.[stepId] as WaterConfig | undefined) ?? {};

  // Read-modify-write on a shared map, so it needs both care and a queue.
  // Reading the *persisted* recipe rather than the resource snapshot handles
  // staleness (the snapshot lags until the post-save refetch lands); chaining
  // handles overlap, since two edits fired in the same tick would otherwise
  // both read the pre-change state and the second would clobber the first.
  let waterWrites: Promise<void> = Promise.resolve();
  const patchWater = (stepId: string, patch: Partial<WaterConfig>): Promise<void> => {
    waterWrites = waterWrites.then(async () => {
      const cur = await repos.recipes.get(p.recipeId);
      if (!cur) return;
      const prev = (cur.overrides?.[stepId] as WaterConfig | undefined) ?? {};
      await saveRecipe({
        ...cur,
        overrides: { ...cur.overrides, [stepId]: { ...prev, ...patch } },
      });
    });
    return waterWrites;
  };

  /** The vessel behind a step's config — supplies the volume ceiling. */
  const stepVessel = (stepId: string): Vessel | undefined =>
    (vessels() ?? []).find((v) => v.id === waterCfg(stepId).vesselId);

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


  /**
   * The step list the editor renders groups from, held stable across saves.
   *
   * `repos.routines.list()` re-parses localStorage, so every revision bump
   * hands back equivalent-but-new step objects. `<For>` keys by reference, so
   * without this it would rebuild every group on each auto-save — destroying
   * the input under the user's cursor and closing the keypad. The custom
   * `equals` keeps the memo (and the DOM) still unless the steps really change.
   */
  const stepList = createMemo<RoutineStep[]>(
    () => parentRoutine()?.steps ?? [],
    [],
    {
      equals: (a, b) =>
        a.length === b.length &&
        a.every((s, i) => s.id === b[i]!.id && s.type === b[i]!.type),
    },
  );

  /** Recipe-level groups (Brewing, Pitcher) render once, at their first step of
   *  that type; per-step groups (Hot water) render for every one. */
  const isFirstOfType = (step: RoutineStep): boolean =>
    stepList().find((s) => s.type === step.type)?.id === step.id;
  const isFirstWaterStep = (step: RoutineStep): boolean =>
    waterSteps()[0]?.id === step.id;

  const brewingGroup = (r: Accessor<Recipe>) => (
    <section class="settings-section" data-testid="recipe-brewing-section">
      <h3>Brewing</h3>
      <p class="settings-help">
        The espresso profile this recipe brews with, the bean it's
        dialled in for, and the numbers. Profiles live on the gateway;
        manage beans in Library → Beans.
      </p>
      <span class="recipe-editor__subfield-label">Profile</span>
      <ProfileFieldRow
        selectedId={r().profileId}
        selectedProfile={() => selectedProfile() ?? null}
        loading={selectedProfile.loading}
        onOpen={() => setProfileDialogOpen(true)}
        onClear={handleProfileClear}
      />
      <span class="recipe-editor__subfield-label">Bean</span>
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
  );

  const pitcherGroup = (r: Accessor<Recipe>) => (
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
  );

  const waterGroup = (step: RoutineStep) => (
    <section
      class="settings-section"
      data-testid={`recipe-water-section-${step.id}`}
    >
      <h3>
        Hot water
        {/* Only label the step when there is more than one to
            tell apart — an ordinary recipe should read like a
            flat field group, not a step list. */}
        <Show when={waterSteps().length > 1}>
          <span class="recipe-editor__step-tag">
            step {(parentRoutine()?.steps ?? []).indexOf(step) + 1}
          </span>
        </Show>
      </h3>
      <Show when={isFirstWaterStep(step)}>
        <p class="settings-help">
          Which vessel this pours into, and how much. Manage
          vessels in Library → Hot Water.
        </p>
      </Show>
      <Show
        when={!vessels.loading}
        fallback={<p class="muted">loading vessels…</p>}
      >
        <select
          class="recipe-editor__routine-select"
          aria-label="Vessel"
          data-testid={`recipe-vessel-select-${step.id}`}
          value={waterCfg(step.id).vesselId ?? ''}
          onChange={(e) =>
            void patchWater(step.id, {
              vesselId: e.currentTarget.value || undefined,
            })
          }
        >
          <option value="">No vessel (pick at brew time)</option>
          <For each={vessels() ?? []}>
            {(v) => (
              <option value={v.id}>
                {v.name} — {v.capacityMl} mL
              </option>
            )}
          </For>
          <Show
            when={
              waterCfg(step.id).vesselId &&
              !(vessels() ?? []).some(
                (v) => v.id === waterCfg(step.id).vesselId,
              )
            }
          >
            {/* Keep a dangling reference selectable + visible. */}
            <option value={waterCfg(step.id).vesselId}>
              (missing vessel — {waterCfg(step.id).vesselId})
            </option>
          </Show>
        </select>
      </Show>
      <div class="recipe-editor__field-row recipe-editor__field-row--stack">
        <label class="recipe-editor__field">
          <span class="recipe-editor__field-label">Volume</span>
          <DebouncedNumberField
            value={waterCfg(step.id).volumeMl}
            onCommit={(v) =>
              void patchWater(step.id, {
                volumeMl:
                  v === undefined
                    ? undefined
                    : clampVolumeToVessel(
                        v,
                        stepVessel(step.id)?.capacityMl,
                      ),
              })
            }
            min={10}
            max={stepVessel(step.id)?.capacityMl ?? VESSEL_CAPACITY_MAX_ML}
            step={10}
            steppers
            unit="mL"
            placeholder="vessel size"
            ariaLabel="Hot water volume (millilitres)"
            testId={`recipe-water-volume-${step.id}`}
            debounceMs={p.debounceMs}
            class="step-field__input"
          />
        </label>
        <label class="recipe-editor__field">
          <span class="recipe-editor__field-label">Temp</span>
          <DebouncedNumberField
            value={waterCfg(step.id).tempC}
            onCommit={(v) => void patchWater(step.id, { tempC: v })}
            min={HOT_WATER_TEMP_MIN_C}
            max={HOT_WATER_TEMP_MAX_C}
            step={1}
            steppers
            unit="°C"
            placeholder="default"
            ariaLabel="Hot water temperature (Celsius)"
            testId={`recipe-water-temp-${step.id}`}
            debounceMs={p.debounceMs}
            class="step-field__input"
          />
        </label>
      </div>
    </section>
  );

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

              {/* Step-derived groups, in the order the routine runs them —
                  the editor should read like the drink is made. Brewing and
                  Pitcher are recipe-level, so they render once at their first
                  step; Hot water is per-step and repeats. A routine with no
                  brew step (Tea) correctly shows no Brewing group at all. */}
              <For each={stepList()}>
                {(step) => (
                  <Switch>
                    <Match when={step.type === 'brew' && isFirstOfType(step)}>
                      {brewingGroup(r)}
                    </Match>
                    <Match when={step.type === 'steam' && isFirstOfType(step)}>
                      {pitcherGroup(r)}
                    </Match>
                    <Match when={step.type === 'water'}>{waterGroup(step)}</Match>
                  </Switch>
                )}
              </For>


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
