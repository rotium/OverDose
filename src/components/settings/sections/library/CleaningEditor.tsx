import {
  For,
  Match,
  Show,
  Switch,
  createResource,
  createSignal,
  type Component,
} from 'solid-js';
import type { Cleaning, CleaningOperation } from '../../../../domain';
import {
  chemicalToggleLabel,
  cleaningKindLabel,
  derivePrep,
  kindUsesChemical,
} from '../../../../domain';
import { useRepositories } from '../../../../RepositoriesContext';
import { DebouncedNumberField } from './DebouncedNumberField';
import { PickerDialog } from '../../../PickerDialog';
import { ProfilePicker } from './ProfilePicker';
import { api, type ProfileRecord } from '../../../../api';

const stripCleaningPrefix = (title: string): string =>
  title.replace(/^Cleaning\//i, '').trim();

/** Cleaning profiles only: by the `Cleaning/` title convention or a cleaning beverage_type. */
const loadCleaningProfiles = (): Promise<ProfileRecord[]> =>
  api.profiles({}).then((recs) =>
    recs.filter(
      (r) =>
        (r.profile.title ?? '').startsWith('Cleaning/') ||
        r.profile.beverage_type === 'cleaning',
    ),
  );

const opWithChemical = (op: CleaningOperation): boolean =>
  op.kind !== 'flush' && op.withChemical === true;

const profileIdOf = (op: CleaningOperation): string | undefined =>
  op.kind === 'profile' ? op.profileId : undefined;

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
  /** Debounce override for tests. */
  debounceMs?: number;
  /** Profile-list fetcher seam (defaults to the cleaning-filtered gateway list). */
  loadProfiles?: () => Promise<ProfileRecord[]>;
  /** Single-profile fetcher for the collapsed selected-profile row. */
  loadProfileById?: (id: string) => Promise<ProfileRecord | null>;
}

/**
 * Cleaning editor — mirrors RecipeEditor (side-sheet, auto-save on change).
 * Fields are conditional on the operation kind; the Prep box is a derived,
 * read-only preview of the wizard's instruction/safety copy (only Notes is
 * editable). See docs/plans/cleaning-feature.md.
 */
export const CleaningEditor: Component<CleaningEditorProps> = (p) => {
  const repos = useRepositories();
  const [cleaning, { refetch }] = createResource(
    () => p.cleaningId,
    (id) => repos.cleanings.get(id),
  );

  const [confirmingDelete, setConfirmingDelete] = createSignal(false);
  const [profileDialogOpen, setProfileDialogOpen] = createSignal(false);

  const save = async (next: Cleaning) => {
    await repos.cleanings.update(next);
    refetch();
  };

  const handleRename = (raw: string) => {
    const next = raw.trim();
    const c = cleaning();
    if (!c || !next || c.name === next) return;
    void save({ ...c, name: next });
  };

  const handleChemicalToggle = (checked: boolean) => {
    const c = cleaning();
    if (!c || c.operation.kind === 'flush') return;
    void save({ ...c, operation: { ...c.operation, withChemical: checked } });
  };

  const handleProfileSelect = (profileId: string) => {
    const c = cleaning();
    setProfileDialogOpen(false);
    if (!c || c.operation.kind !== 'profile' || c.operation.profileId === profileId) return;
    void save({ ...c, operation: { ...c.operation, profileId } });
  };

  const handleProfileClear = () => {
    const c = cleaning();
    if (!c || c.operation.kind !== 'profile' || c.operation.profileId === undefined) return;
    void save({ ...c, operation: { ...c.operation, profileId: undefined } });
  };

  const handleRemindersToggle = (checked: boolean) => {
    const c = cleaning();
    if (!c) return;
    void save({ ...c, cadence: checked ? { byDays: 7 } : undefined });
  };

  const handleByDaysCommit = (n: number | undefined) => {
    const c = cleaning();
    if (!c) return;
    void save({ ...c, cadence: { ...c.cadence, byDays: n } });
  };

  const handleByShotsCommit = (n: number | undefined) => {
    const c = cleaning();
    if (!c) return;
    void save({ ...c, cadence: { ...c.cadence, byShots: n } });
  };

  const handleNotesChange = (raw: string) => {
    const c = cleaning();
    if (!c) return;
    const next = raw.trim() || undefined;
    if (c.notes === next) return;
    void save({ ...c, notes: next });
  };

  // Reset reminder: neutral — restart the cadence clock without claiming a run.
  // (Shot-count baseline is reset by the wizard / Alerts once the live shot
  // total is wired; here we reset the time dimension.)
  const handleReset = () => {
    const c = cleaning();
    if (!c) return;
    void save({ ...c, lastDoneAt: new Date().toISOString() });
  };

  const handlePinnedToggle = (checked: boolean) => {
    const c = cleaning();
    if (!c) return;
    void save({ ...c, pinnedToHome: checked });
  };

  const handleDelete = async () => {
    await repos.cleanings.delete(p.cleaningId);
    p.onClose();
  };

  // Resolve the selected cleaning profile's title for the collapsed row.
  const loadProfileById = (id: string): Promise<ProfileRecord | null> =>
    (p.loadProfileById ?? ((x) => api.profileById(x).catch(() => null)))(id);
  const [selectedProfile] = createResource<ProfileRecord | null, string>(
    () => {
      const c = cleaning();
      return c ? profileIdOf(c.operation) : undefined;
    },
    (id) => loadProfileById(id),
  );

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
              <p
                class="cleaning-editor__subtitle"
                data-testid="cleaning-operation"
              >
                {cleaningKindLabel(c().operation.kind)}
              </p>

              <section class="settings-section">
                <h3>Setup</h3>
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

                  <Show when={c().operation.kind === 'profile'}>
                    <div class="cleaning-editor__row">
                      <span class="cleaning-editor__row-label">Profile</span>
                      <ProfileFieldRow
                        selectedId={profileIdOf(c().operation)}
                        selectedProfile={() => selectedProfile() ?? null}
                        loading={selectedProfile.loading}
                        onOpen={() => setProfileDialogOpen(true)}
                        onClear={handleProfileClear}
                      />
                    </div>
                  </Show>

                  <Show when={kindUsesChemical(c().operation.kind)}>
                    <label
                      class="settings-checkbox"
                      data-testid="cleaning-chemical-toggle"
                    >
                      <input
                        type="checkbox"
                        data-testid="cleaning-with-chemical"
                        checked={opWithChemical(c().operation)}
                        onChange={(e) =>
                          handleChemicalToggle(e.currentTarget.checked)
                        }
                      />
                      <span>{chemicalToggleLabel(c().operation.kind)}</span>
                    </label>
                  </Show>

                  <label
                    class="settings-checkbox"
                    data-testid="cleaning-pinned-toggle"
                  >
                    <input
                      type="checkbox"
                      data-testid="cleaning-pinned-to-home"
                      checked={!!c().pinnedToHome}
                      onChange={(e) => handlePinnedToggle(e.currentTarget.checked)}
                    />
                    <span>Show on the home screen</span>
                  </label>
                </div>
              </section>

              <section class="settings-section">
                <h3>Reminders</h3>
                <div class="cleaning-editor__fields">
                  <label
                    class="settings-checkbox"
                    data-testid="cleaning-reminders-toggle"
                  >
                    <input
                      type="checkbox"
                      data-testid="cleaning-remind-me"
                      checked={c().cadence !== undefined}
                      onChange={(e) =>
                        handleRemindersToggle(e.currentTarget.checked)
                      }
                    />
                    <span>Remind me</span>
                  </label>
                  <Show when={c().cadence !== undefined}>
                    <div class="recipe-editor__field-row">
                      <label class="recipe-editor__field">
                        <span class="recipe-editor__field-label">Every</span>
                        <DebouncedNumberField
                          value={c().cadence?.byDays}
                          onCommit={handleByDaysCommit}
                          placeholder="days"
                          min={0}
                          step={1}
                          ariaLabel="Remind every N days"
                          testId="cleaning-by-days"
                          debounceMs={p.debounceMs}
                          class="step-field__input"
                        />
                        <span class="step-field__unit">days</span>
                      </label>
                      <label class="recipe-editor__field">
                        <span class="recipe-editor__field-label">and/or</span>
                        <DebouncedNumberField
                          value={c().cadence?.byShots}
                          onCommit={handleByShotsCommit}
                          placeholder="shots"
                          min={0}
                          step={1}
                          ariaLabel="Remind every N shots"
                          testId="cleaning-by-shots"
                          debounceMs={p.debounceMs}
                          class="step-field__input"
                        />
                        <span class="step-field__unit">shots</span>
                      </label>
                    </div>
                  </Show>

                  <div class="cleaning-editor__row">
                    <span class="cleaning-editor__row-label">Last done</span>
                    <span
                      class="cleaning-editor__row-value"
                      data-testid="cleaning-last-done"
                    >
                      {formatLastDone(c().lastDoneAt)}
                    </span>
                    <button
                      type="button"
                      class="btn"
                      data-testid="cleaning-reset-reminder"
                      onClick={handleReset}
                    >
                      Reset reminder
                    </button>
                  </div>
                </div>
              </section>

              <section class="settings-section">
                <h3>Prep &amp; notes</h3>
                <div class="cleaning-editor__fields">
                  <ul
                    class="cleaning-editor__prep"
                    data-testid="cleaning-prep"
                  >
                    <For each={derivePrep(c().operation).lines}>
                      {(line) => <li>{line}</li>}
                    </For>
                  </ul>
                  <Show when={derivePrep(c().operation).durationHint}>
                    <p
                      class="settings-help"
                      data-testid="cleaning-prep-duration"
                    >
                      Takes {derivePrep(c().operation).durationHint}.
                    </p>
                  </Show>
                  <div class="cleaning-editor__row">
                    <span class="cleaning-editor__row-label">Notes</span>
                    <input
                      type="text"
                      class="routine-editor__name cleaning-editor__row-input"
                      value={c().notes ?? ''}
                      aria-label="Notes"
                      data-testid="cleaning-notes-input"
                      placeholder="e.g. green-lid Cafiza tub, ½ tsp"
                      onChange={(e) => handleNotesChange(e.currentTarget.value)}
                    />
                  </div>
                </div>
              </section>

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
                open={profileDialogOpen()}
                onClose={() => setProfileDialogOpen(false)}
                title="Choose a cleaning profile"
                description="Cleaning profiles loaded on the gateway."
                testId="cleaning-profile-dialog"
                maxWidthPx={1100}
              >
                <ProfilePicker
                  selectedId={profileIdOf(c().operation)}
                  onSelect={handleProfileSelect}
                  onCancel={() => setProfileDialogOpen(false)}
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

interface ProfileFieldRowProps {
  selectedId: string | undefined;
  selectedProfile: () => ProfileRecord | null;
  loading: boolean;
  onOpen: () => void;
  onClear: () => void;
}

/** Collapsed display of the chosen cleaning profile (prefix stripped). */
const ProfileFieldRow: Component<ProfileFieldRowProps> = (p) => {
  const hasId = (): boolean => !!p.selectedId;
  const title = (): string => {
    const rec = p.selectedProfile();
    if (rec) return stripCleaningPrefix((rec.profile.title ?? '').trim()) || '(untitled)';
    if (p.loading) return 'Loading…';
    return `(missing profile — ${p.selectedId})`;
  };
  return (
    <div
      class="recipe-editor__profile-field"
      data-testid="cleaning-editor-profile-field"
    >
      <button
        type="button"
        class="recipe-editor__profile-button"
        data-testid="cleaning-profile-open"
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
          data-testid="cleaning-profile-clear"
          aria-label="Clear selected profile"
          onClick={p.onClear}
        >
          ×
        </button>
      </Show>
    </div>
  );
};
