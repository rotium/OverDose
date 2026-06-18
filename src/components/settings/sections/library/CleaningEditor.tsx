import {
  For,
  Match,
  Show,
  Switch,
  createResource,
  createSignal,
  type Component,
} from 'solid-js';
import type {
  Cleaning,
  CleanStep,
  CleanStepType,
  CleaningOperation,
  Reminder,
  ReminderUnit,
} from '../../../../domain';
import {
  CLEAN_STEP_TYPES,
  DEFAULT_FLUSH_SECONDS,
  DEFAULT_PURGE_SECONDS,
  DEFAULT_REMINDER,
  DEFAULT_STEAM_SECONDS,
  DEFAULT_THIMBLE_MIN,
  DEFAULT_TIP_SOAK_MIN,
  DESCALE_CHEMICAL_LABEL,
  REMINDER_UNITS,
  WEEKDAY_LABELS,
  cleanStepLabel,
  cleaningKindLabel,
  computeFirstOccurrence,
  deriveDescalePrep,
  formatOccurrence,
  newCleanStep,
  nextOccurrence,
  reminderUnitLabel,
  stepChemicalLabel,
  stepUsesChemical,
} from '../../../../domain';
import { useRepositories } from '../../../../RepositoriesContext';
import { DebouncedNumberField } from './DebouncedNumberField';
import { PickerDialog } from '../../../PickerDialog';
import { ProfilePicker } from './ProfilePicker';
import { api, type ProfileRecord } from '../../../../api';

const stripCleaningPrefix = (title: string): string =>
  title.replace(/^Cleaning\//i, '').trim();

/** Cleaning profiles only: by the `Cleaning/` title convention or beverage_type. */
const loadCleaningProfiles = (): Promise<ProfileRecord[]> =>
  api.profiles({}).then((recs) =>
    recs.filter(
      (r) =>
        (r.profile.title ?? '').startsWith('Cleaning/') ||
        r.profile.beverage_type === 'cleaning',
    ),
  );

const formatLastDone = (iso: string | undefined): string => {
  if (!iso) return 'never';
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return 'never';
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return 'today';
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

export interface CleaningEditorProps {
  cleaningId: string;
  onClose: () => void;
  debounceMs?: number;
  /** Profile-list fetcher seam (defaults to the cleaning-filtered gateway list). */
  loadProfiles?: () => Promise<ProfileRecord[]>;
}

/**
 * Cleaning editor — mirrors RecipeEditor (side-sheet, auto-save). Two modes:
 * **Clean** is a user-composed step builder (reorder via ↑/↓ like RoutineEditor,
 * + Add step, per-step chemical, coffee-side profile); **Descale** is fixed
 * (citric toggle + prep). See docs/plans/cleaning-feature.md.
 */
export const CleaningEditor: Component<CleaningEditorProps> = (p) => {
  const repos = useRepositories();
  const [cleaning, { refetch }] = createResource(
    () => p.cleaningId,
    (id) => repos.cleanings.get(id),
  );

  const [confirmingDelete, setConfirmingDelete] = createSignal(false);
  const [addingStep, setAddingStep] = createSignal(false);
  // Which coffee-side step's profile dialog is open (its step id), or null.
  const [profileStepId, setProfileStepId] = createSignal<string | null>(null);

  const [profiles] = createResource(() =>
    (p.loadProfiles ?? loadCleaningProfiles)().catch(() => [] as ProfileRecord[]),
  );

  const save = async (next: Cleaning) => {
    await repos.cleanings.update(next);
    refetch();
  };

  const cleanSteps = (): CleanStep[] => {
    const c = cleaning();
    return c && c.operation.kind === 'clean' ? c.operation.steps : [];
  };

  const saveSteps = (steps: CleanStep[]) => {
    const c = cleaning();
    if (!c || c.operation.kind !== 'clean') return;
    void save({ ...c, operation: { kind: 'clean', steps } });
  };

  const handleAddStep = (type: CleanStepType) => {
    setAddingStep(false);
    saveSteps([...cleanSteps(), newCleanStep(type)]);
  };

  const handleRemoveStep = (id: string) =>
    saveSteps(cleanSteps().filter((s) => s.id !== id));

  const handleMoveStep = (id: string, dir: -1 | 1) => {
    const steps = [...cleanSteps()];
    const i = steps.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    saveSteps(steps);
  };

  const updateStep = (
    id: string,
    patch: {
      withChemical?: boolean;
      profileId?: string;
      seconds?: number;
      minutes?: number;
    },
  ) =>
    saveSteps(
      cleanSteps().map((s) => (s.id === id ? ({ ...s, ...patch } as CleanStep) : s)),
    );

  const profileTitleOf = (id?: string): string => {
    if (!id) return 'Forward Flush x5 (default)';
    const rec = (profiles() ?? []).find((r) => r.id === id);
    return rec
      ? stripCleaningPrefix((rec.profile.title ?? '').trim()) || '(untitled)'
      : 'Selected profile';
  };

  const editingStepProfileId = (): string | undefined => {
    const id = profileStepId();
    const step = cleanSteps().find((s) => s.id === id);
    return step && step.type === 'coffeeSide' ? step.profileId : undefined;
  };

  const handleStepProfileSelect = (profileId: string) => {
    const id = profileStepId();
    setProfileStepId(null);
    if (id) updateStep(id, { profileId });
  };

  // Descale
  const descaleWithChemical = (): boolean => {
    const c = cleaning();
    return c?.operation.kind === 'descale' ? !!c.operation.withChemical : false;
  };
  const handleDescaleChemical = (checked: boolean) => {
    const c = cleaning();
    if (!c || c.operation.kind !== 'descale') return;
    void save({ ...c, operation: { kind: 'descale', withChemical: checked } });
  };

  // Shared
  const handleRename = (raw: string) => {
    const next = raw.trim();
    const c = cleaning();
    if (!c || !next || c.name === next) return;
    void save({ ...c, name: next });
  };
  const handleRemindersToggle = (checked: boolean) => {
    const c = cleaning();
    if (!c) return;
    const reminder = checked
      ? { ...DEFAULT_REMINDER, anchor: computeFirstOccurrence(DEFAULT_REMINDER, Date.now()) }
      : undefined;
    void save({ ...c, reminder });
  };
  /** Merge a spec change and re-anchor the grid from now. */
  const updateReminder = (patch: Partial<Omit<Reminder, 'anchor'>>) => {
    const c = cleaning();
    if (!c?.reminder) return;
    const spec: Omit<Reminder, 'anchor'> = { ...c.reminder, ...patch };
    if (spec.unit === 'week' && spec.weekday === undefined) spec.weekday = 1;
    if (spec.unit === 'month' && spec.dayOfMonth === undefined) spec.dayOfMonth = 1;
    void save({ ...c, reminder: { ...spec, anchor: computeFirstOccurrence(spec, Date.now()) } });
  };
  const handleNotesChange = (raw: string) => {
    const c = cleaning();
    if (!c) return;
    const next = raw.trim() || undefined;
    if (c.notes === next) return;
    void save({ ...c, notes: next });
  };
  const handleHiddenToggle = (checked: boolean) => {
    const c = cleaning();
    if (!c) return;
    void save({ ...c, hidden: checked });
  };
  const handleDelete = async () => {
    await repos.cleanings.delete(p.cleaningId);
    p.onClose();
  };

  const operationOf = (c: Cleaning): CleaningOperation => c.operation;

  return (
    <div class="settings-section-stack" data-testid="cleaning-editor">
      <h2 class="routine-editor__title">Edit Cleaning</h2>

      <Switch>
        <Match when={cleaning.loading}>
          <p class="muted">loading…</p>
        </Match>
        <Match when={cleaning() === null}>
          <p class="muted" role="alert">
            cleaning not found
          </p>
        </Match>
        <Match when={cleaning()}>
          {(c) => (
            <>
              <p class="cleaning-editor__subtitle" data-testid="cleaning-operation">
                {cleaningKindLabel(operationOf(c()).kind)}
              </p>

              <section class="settings-section">
                <div class="cleaning-editor__fields">
                  <div class="cleaning-editor__row">
                    <span class="cleaning-editor__row-label">Name</span>
                    <input
                      type="text"
                      class="routine-editor__name cleaning-editor__row-input"
                      value={c().name}
                      aria-label="Cleaning name"
                      data-testid="cleaning-name-input"
                      onChange={(e) => handleRename(e.currentTarget.value)}
                    />
                  </div>
                </div>
              </section>

              {/* ── Clean: step builder ───────────────────────────────── */}
              <Show when={operationOf(c()).kind === 'clean'}>
                <section class="settings-section">
                  <h3>Steps</h3>
                  <Show
                    when={cleanSteps().length > 0}
                    fallback={<p class="muted">No steps yet — add one below.</p>}
                  >
                    <ul class="cleaning-editor__steps" data-testid="cleaning-steps">
                      <For each={cleanSteps()}>
                        {(s, i) => (
                          <li
                            class="cleaning-editor__step"
                            data-testid={`cleaning-step-${s.id}`}
                          >
                            <div class="cleaning-editor__step-reorder">
                              <button
                                type="button"
                                class="icon-btn"
                                aria-label="Move up"
                                data-testid={`step-up-${s.id}`}
                                disabled={i() === 0}
                                onClick={() => handleMoveStep(s.id, -1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                class="icon-btn"
                                aria-label="Move down"
                                data-testid={`step-down-${s.id}`}
                                disabled={i() === cleanSteps().length - 1}
                                onClick={() => handleMoveStep(s.id, 1)}
                              >
                                ↓
                              </button>
                            </div>
                            <div class="cleaning-editor__step-main">
                              <span class="cleaning-editor__step-label">
                                {cleanStepLabel(s.type)}
                              </span>
                              <Show when={stepUsesChemical(s.type)}>
                                <label class="settings-checkbox cleaning-editor__check">
                                  <input
                                    type="checkbox"
                                    data-testid={`step-chemical-${s.id}`}
                                    checked={
                                      (s.type === 'coffeeSide' ||
                                        s.type === 'steamWand') &&
                                      s.withChemical === true
                                    }
                                    onChange={(e) =>
                                      updateStep(s.id, {
                                        withChemical: e.currentTarget.checked,
                                      })
                                    }
                                  />
                                  <span>{stepChemicalLabel(s.type)}</span>
                                </label>
                              </Show>
                              <Show when={s.type === 'coffeeSide'}>
                                <button
                                  type="button"
                                  class="cleaning-editor__step-profile"
                                  data-testid={`step-profile-${s.id}`}
                                  onClick={() => setProfileStepId(s.id)}
                                >
                                  Profile:{' '}
                                  {profileTitleOf(
                                    s.type === 'coffeeSide' ? s.profileId : undefined,
                                  )}{' '}
                                  ›
                                </button>
                              </Show>
                              <Show when={s.type === 'flush'}>
                                <label class="recipe-editor__field">
                                  <span class="recipe-editor__field-label">
                                    Flush for
                                  </span>
                                  <DebouncedNumberField
                                    value={
                                      s.type === 'flush'
                                        ? s.seconds ?? DEFAULT_FLUSH_SECONDS
                                        : undefined
                                    }
                                    onCommit={(n) =>
                                      updateStep(s.id, {
                                        seconds: n ?? DEFAULT_FLUSH_SECONDS,
                                      })
                                    }
                                    min={1}
                                    step={1}
                                    steppers
                                    unit="s"
                                    placeholder="s"
                                    ariaLabel="Flush seconds"
                                    testId={`step-seconds-${s.id}`}
                                    debounceMs={p.debounceMs}
                                    class="step-field__input"
                                  />
                                  <span class="step-field__unit">s</span>
                                </label>
                              </Show>
                              <Show when={s.type === 'steamWand'}>
                                <label class="recipe-editor__field">
                                  <span class="recipe-editor__field-label">
                                    Steam for
                                  </span>
                                  <DebouncedNumberField
                                    value={
                                      s.type === 'steamWand'
                                        ? s.seconds ?? DEFAULT_STEAM_SECONDS
                                        : undefined
                                    }
                                    onCommit={(n) =>
                                      updateStep(s.id, {
                                        seconds: n ?? DEFAULT_STEAM_SECONDS,
                                      })
                                    }
                                    min={1}
                                    step={1}
                                    steppers
                                    unit="s"
                                    placeholder="s"
                                    ariaLabel="Steam seconds"
                                    testId={`step-seconds-${s.id}`}
                                    debounceMs={p.debounceMs}
                                    class="step-field__input"
                                  />
                                  <span class="step-field__unit">s</span>
                                </label>
                              </Show>
                              <Show when={s.type === 'steamPurge'}>
                                <label class="recipe-editor__field">
                                  <span class="recipe-editor__field-label">
                                    Purge for
                                  </span>
                                  <DebouncedNumberField
                                    value={
                                      s.type === 'steamPurge'
                                        ? s.seconds ?? DEFAULT_PURGE_SECONDS
                                        : undefined
                                    }
                                    onCommit={(n) =>
                                      updateStep(s.id, {
                                        seconds: n ?? DEFAULT_PURGE_SECONDS,
                                      })
                                    }
                                    min={1}
                                    step={1}
                                    steppers
                                    unit="s"
                                    placeholder="s"
                                    ariaLabel="Purge seconds"
                                    testId={`step-seconds-${s.id}`}
                                    debounceMs={p.debounceMs}
                                    class="step-field__input"
                                  />
                                  <span class="step-field__unit">s</span>
                                </label>
                              </Show>
                              <Show
                                when={
                                  s.type === 'steamWandSoak' || s.type === 'thimble'
                                }
                              >
                                <label class="recipe-editor__field">
                                  <span class="recipe-editor__field-label">
                                    Timer
                                  </span>
                                  <DebouncedNumberField
                                    value={
                                      s.type === 'steamWandSoak'
                                        ? s.minutes ?? DEFAULT_TIP_SOAK_MIN
                                        : s.type === 'thimble'
                                          ? s.minutes ?? DEFAULT_THIMBLE_MIN
                                          : undefined
                                    }
                                    onCommit={(n) =>
                                      updateStep(s.id, {
                                        minutes:
                                          n ??
                                          (s.type === 'thimble'
                                            ? DEFAULT_THIMBLE_MIN
                                            : DEFAULT_TIP_SOAK_MIN),
                                      })
                                    }
                                    min={1}
                                    step={1}
                                    steppers
                                    unit="min"
                                    placeholder="min"
                                    ariaLabel="Soak timer minutes"
                                    testId={`step-minutes-${s.id}`}
                                    debounceMs={p.debounceMs}
                                    class="step-field__input"
                                  />
                                  <span class="step-field__unit">min</span>
                                </label>
                              </Show>
                            </div>
                            <button
                              type="button"
                              class="cleaning-editor__step-remove"
                              aria-label={`Remove ${cleanStepLabel(s.type)}`}
                              data-testid={`step-remove-${s.id}`}
                              onClick={() => handleRemoveStep(s.id)}
                            >
                              ×
                            </button>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>

                  <Show
                    when={addingStep()}
                    fallback={
                      <button
                        type="button"
                        class="btn"
                        data-testid="open-add-step"
                        onClick={() => setAddingStep(true)}
                      >
                        + Add step
                      </button>
                    }
                  >
                    <div class="cleaning-editor__add-steps" data-testid="add-step-picker">
                      <For each={CLEAN_STEP_TYPES}>
                        {(t) => (
                          <button
                            type="button"
                            class="btn"
                            data-testid={`add-step-${t}`}
                            onClick={() => handleAddStep(t)}
                          >
                            {cleanStepLabel(t)}
                          </button>
                        )}
                      </For>
                      <button
                        type="button"
                        class="btn"
                        onClick={() => setAddingStep(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </Show>
                </section>
              </Show>

              {/* ── Descale: fixed ────────────────────────────────────── */}
              <Show when={operationOf(c()).kind === 'descale'}>
                <section class="settings-section">
                  <label
                    class="settings-checkbox cleaning-editor__check"
                    data-testid="descale-chemical-toggle"
                  >
                    <input
                      type="checkbox"
                      data-testid="descale-with-chemical"
                      checked={descaleWithChemical()}
                      onChange={(e) => handleDescaleChemical(e.currentTarget.checked)}
                    />
                    <span>{DESCALE_CHEMICAL_LABEL}</span>
                  </label>
                  <ul class="cleaning-editor__prep" data-testid="descale-prep">
                    <For
                      each={deriveDescalePrep({
                        kind: 'descale',
                        withChemical: descaleWithChemical(),
                      })}
                    >
                      {(line) => <li>{line}</li>}
                    </For>
                  </ul>
                </section>
              </Show>

              {/* ── Shared: reminders, notes, hide, delete ───────────── */}
              <section class="settings-section">
                <h3>Reminders</h3>
                <div class="cleaning-editor__fields">
                  <label
                    class="settings-checkbox cleaning-editor__check"
                    data-testid="cleaning-reminders-toggle"
                  >
                    <input
                      type="checkbox"
                      data-testid="cleaning-remind-me"
                      checked={c().reminder !== undefined}
                      onChange={(e) => handleRemindersToggle(e.currentTarget.checked)}
                    />
                    <span>Remind me</span>
                  </label>
                  <Show when={c().reminder}>
                    {(r) => (
                      <>
                        <div class="recipe-editor__field-row cleaning-editor__reminder">
                          <label class="recipe-editor__field">
                            <span class="recipe-editor__field-label">Every</span>
                            <DebouncedNumberField
                              value={r().every}
                              onCommit={(n) => updateReminder({ every: Math.max(1, n ?? 1) })}
                              min={1}
                              step={1}
                              steppers
                              placeholder="1"
                              ariaLabel="Remind every"
                              testId="cleaning-every"
                              debounceMs={p.debounceMs}
                              class="step-field__input"
                            />
                          </label>
                          <select
                            aria-label="Reminder unit"
                            data-testid="cleaning-unit"
                            class="recipe-editor__routine-select"
                            value={r().unit}
                            onChange={(e) =>
                              updateReminder({ unit: e.currentTarget.value as ReminderUnit })
                            }
                          >
                            <For each={REMINDER_UNITS}>
                              {(u) => (
                                <option value={u}>{reminderUnitLabel(u, r().every)}</option>
                              )}
                            </For>
                          </select>
                          <Show when={r().unit === 'week'}>
                            <select
                              aria-label="Reminder weekday"
                              data-testid="cleaning-weekday"
                              class="recipe-editor__routine-select"
                              value={String(r().weekday ?? 1)}
                              onChange={(e) =>
                                updateReminder({ weekday: Number(e.currentTarget.value) })
                              }
                            >
                              <For each={WEEKDAY_LABELS}>
                                {(label, i) => <option value={String(i())}>{label}</option>}
                              </For>
                            </select>
                          </Show>
                          <Show when={r().unit === 'month'}>
                            <label class="recipe-editor__field">
                              <span class="recipe-editor__field-label">on day</span>
                              <DebouncedNumberField
                                value={r().dayOfMonth ?? 1}
                                onCommit={(n) =>
                                  updateReminder({
                                    dayOfMonth: Math.min(31, Math.max(1, n ?? 1)),
                                  })
                                }
                                min={1}
                                step={1}
                                steppers
                                placeholder="1"
                                ariaLabel="Day of month"
                                testId="cleaning-day-of-month"
                                debounceMs={p.debounceMs}
                                class="step-field__input"
                              />
                            </label>
                          </Show>
                          <label class="recipe-editor__field">
                            <span class="recipe-editor__field-label">at</span>
                            <input
                              type="time"
                              class="cleaning-editor__time-input"
                              data-testid="cleaning-at-time"
                              aria-label="Reminder time"
                              value={r().atTime}
                              onChange={(e) => updateReminder({ atTime: e.currentTarget.value })}
                            />
                          </label>
                        </div>
                        <p class="settings-help" data-testid="cleaning-next-preview">
                          Next: {formatOccurrence(nextOccurrence(r(), Date.now()))}
                        </p>
                      </>
                    )}
                  </Show>
                  <div class="cleaning-editor__row">
                    <span class="cleaning-editor__row-label">Last done</span>
                    <span
                      class="cleaning-editor__row-value"
                      data-testid="cleaning-last-done"
                    >
                      {formatLastDone(c().lastDoneAt)}
                    </span>
                  </div>
                </div>
              </section>

              <section class="settings-section">
                <div class="cleaning-editor__fields">
                  <div class="cleaning-editor__row">
                    <span class="cleaning-editor__row-label">Notes</span>
                    <input
                      type="text"
                      class="routine-editor__name cleaning-editor__row-input"
                      value={c().notes ?? ''}
                      aria-label="Notes"
                      data-testid="cleaning-notes-input"
                      placeholder="e.g. green-lid Cafiza; Rinza tablets"
                      onChange={(e) => handleNotesChange(e.currentTarget.value)}
                    />
                  </div>
                </div>
              </section>

              <label
                class="settings-checkbox cleaning-editor__check cleaning-editor__hide-toggle"
                data-testid="cleaning-hidden-toggle"
              >
                <input
                  type="checkbox"
                  data-testid="cleaning-hide-from-home"
                  checked={!!c().hidden}
                  onChange={(e) => handleHiddenToggle(e.currentTarget.checked)}
                />
                <span>Hide from the home screen</span>
              </label>

              <section class="settings-section">
                <Show
                  when={confirmingDelete()}
                  fallback={
                    <button
                      type="button"
                      class="btn btn--danger"
                      data-testid="delete-cleaning-button"
                      onClick={() => setConfirmingDelete(true)}
                    >
                      Delete cleaning
                    </button>
                  }
                >
                  <div
                    class="routine-editor__delete-confirm"
                    data-testid="delete-confirm"
                  >
                    <p>Delete "{c().name}"? This can't be undone.</p>
                    <div class="routine-editor__button-row">
                      <button
                        type="button"
                        class="btn btn--danger"
                        data-testid="confirm-delete-cleaning-button"
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
                open={profileStepId() !== null}
                onClose={() => setProfileStepId(null)}
                title="Choose a cleaning profile"
                description="Cleaning profiles loaded on the gateway."
                testId="cleaning-profile-dialog"
                maxWidthPx={1100}
              >
                <ProfilePicker
                  selectedId={editingStepProfileId()}
                  onSelect={handleStepProfileSelect}
                  onCancel={() => setProfileStepId(null)}
                  loadProfiles={p.loadProfiles ?? loadCleaningProfiles}
                />
              </PickerDialog>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
};
