import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  type Accessor,
  type Component,
} from 'solid-js';
import { api, type ProfileRecord } from '../../../../api';
import { ProfilePreview } from './ProfilePreview';
import { log } from '../../../../debugLog';

/**
 * Master-detail profile picker. Left column lists profiles (title +
 * author + default badge); right column shows the detail pane (curve
 * preview + metadata + step list). Used by:
 *
 *   - `ProfilesSection` (Library tab, browse-only) — no commit footer.
 *   - `RecipeEditor` (inside a PickerDialog) — Cancel + Choose footer
 *     committed only when the user presses Choose.
 *
 * Selection model:
 *
 *   `selectedId`   — what the parent has pinned (Recipe.profileId). Pre-
 *                    highlights the row when the picker opens and seeds
 *                    the initial preview.
 *   `previewedId`  — internal state. Tracks the row the user is
 *                    inspecting in this session. Tap a row to update;
 *                    Choose commits the previewed id via `onSelect`.
 *
 * Two states are needed because tapping a row should NOT commit (the v1
 * behavior). That made browsing impossible — now you can scroll through
 * profiles previewing each one, then commit (or Cancel) at the end.
 *
 * The footer (Cancel + Choose) is rendered inside the picker itself, not
 * delegated to the parent dialog's footer slot — keeps the picker self-
 * contained and lets it own the `previewedId → onSelect` plumbing
 * without exposing internals.
 */
export interface ProfilePickerProps {
  /** Currently-pinned profile id from the parent. Pre-selects the row +
   *  drives the initial preview. */
  selectedId?: string;
  /** Called with the previewed id when the user presses Choose. Omit
   *  for browse-only mode (no footer rendered). */
  onSelect?: (id: string) => void;
  /** Called when the user presses Cancel. Required when `onSelect` is
   *  provided — typically closes the parent dialog. */
  onCancel?: () => void;
  /** Fetcher seam for tests. Defaults to `api.profiles({})`. */
  loadProfiles?: () => Promise<ProfileRecord[]>;
}

const profileTitle = (r: ProfileRecord): string =>
  (r.profile.title ?? '').trim() || '(untitled)';

const sortAlpha = (a: ProfileRecord, b: ProfileRecord): number =>
  profileTitle(a).localeCompare(profileTitle(b), undefined, {
    sensitivity: 'base',
  });

export const ProfilePicker: Component<ProfilePickerProps> = (p) => {
  // Resource swallows its own errors and resolves to `null` so Solid
  // doesn't leak unhandled rejections (same pattern as MachineTab).
  const [profiles] = createResource<ProfileRecord[] | null>(() =>
    (p.loadProfiles ?? (() => api.profiles({})))().catch((e) => {
      log.warn('profile', 'profile load failed', e);
      return null;
    }),
  );

  const sorted = createMemo<ProfileRecord[]>(() => {
    const list = profiles();
    if (!list) return [];
    return [...list].sort(sortAlpha);
  });

  // `previewedId` defaults to `selectedId` (so opening the picker
  // immediately shows the currently-pinned profile) and falls back to the
  // first visible profile once the list resolves. The explicit signal
  // lets us update on row taps without touching `selectedId`.
  const [previewedId, setPreviewedId] = createSignal<string | undefined>(
    p.selectedId,
  );

  // Seed the previewed id from the first profile when none has been
  // chosen yet. Uses createEffect (not createMemo — this is a side effect,
  // not a derived value).
  createEffect(() => {
    if (previewedId() !== undefined) return;
    const first = sorted()[0];
    if (first) setPreviewedId(first.id);
  });

  const currentRecord = createMemo<ProfileRecord | null>(() => {
    const id = previewedId();
    if (!id) return null;
    return sorted().find((r) => r.id === id) ?? null;
  });

  const handleRowClick = (id: string) => {
    setPreviewedId(id);
  };

  const handleChoose = () => {
    const id = previewedId();
    if (id && p.onSelect) p.onSelect(id);
  };

  const handleCancel = () => {
    if (p.onCancel) p.onCancel();
  };

  const isSelectMode = (): boolean => !!p.onSelect;

  return (
    <div class="profile-picker" data-testid="profile-picker">
      <Switch>
        <Match when={profiles.loading}>
          <p class="profile-picker__status" data-testid="profile-picker-loading">
            Loading profiles…
          </p>
        </Match>
        <Match when={profiles() === null}>
          <p
            class="profile-picker__status profile-picker__status--error"
            data-testid="profile-picker-error"
            role="alert"
          >
            Couldn't load profiles — check the gateway connection.
          </p>
        </Match>
        <Match when={profiles() && sorted().length === 0}>
          <p class="profile-picker__status" data-testid="profile-picker-empty">
            No profiles available.
          </p>
        </Match>
        <Match when={profiles() && sorted().length > 0}>
          <div
            class="profile-picker__split"
            data-testid="profile-picker-split"
          >
            <ProfileList
              profiles={sorted}
              previewedId={previewedId}
              selectedId={() => p.selectedId}
              onRowClick={handleRowClick}
            />
            <div class="profile-picker__detail">
              <ProfilePreview record={currentRecord()} />
            </div>
          </div>
        </Match>
      </Switch>
      <Show when={isSelectMode() && sorted().length > 0}>
        <footer
          class="profile-picker__footer"
          data-testid="profile-picker-footer"
        >
          <button
            type="button"
            class="btn"
            data-testid="profile-picker-cancel"
            onClick={handleCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn btn--primary"
            data-testid="profile-picker-choose"
            onClick={handleChoose}
            disabled={previewedId() === undefined}
          >
            Choose
          </button>
        </footer>
      </Show>
    </div>
  );
};

interface ProfileListProps {
  profiles: Accessor<ProfileRecord[]>;
  previewedId: Accessor<string | undefined>;
  selectedId: Accessor<string | undefined>;
  onRowClick: (id: string) => void;
}

const ProfileList: Component<ProfileListProps> = (p) => (
  <ul
    class="profile-picker__list"
    role="listbox"
    data-testid="profile-picker-list"
  >
    <For each={p.profiles()}>
      {(r) => (
        <ProfileListRow
          record={r}
          previewed={p.previewedId() === r.id}
          selected={p.selectedId() === r.id}
          onClick={() => p.onRowClick(r.id)}
        />
      )}
    </For>
  </ul>
);

interface ProfileListRowProps {
  record: ProfileRecord;
  /** Currently being inspected in this picker session — highlighted. */
  previewed: boolean;
  /** What the parent has pinned (Recipe.profileId). Shows a checkmark
   *  even when the user is browsing a different row. */
  selected: boolean;
  onClick: () => void;
}

const ProfileListRow: Component<ProfileListRowProps> = (p) => {
  const title = (): string => profileTitle(p.record);
  const author = (): string => (p.record.profile.author ?? '').trim();
  return (
    <li
      class="profile-row"
      data-testid={`profile-row-${p.record.id}`}
      data-previewed={p.previewed || undefined}
      data-selected={p.selected || undefined}
      data-default={p.record.isDefault || undefined}
      role="option"
      aria-selected={p.previewed}
    >
      <button
        type="button"
        class="profile-row__button"
        data-testid={`profile-row-${p.record.id}-button`}
        aria-label={`Preview profile ${title()}`}
        onClick={p.onClick}
      >
        <div class="profile-row__inner profile-row__inner--two-line">
          <div class="profile-row__head">
            <span class="profile-row__title">{title()}</span>
            <Show when={p.selected}>
              <span
                class="profile-row__selected"
                data-testid={`profile-row-${p.record.id}-selected`}
                aria-label="Currently pinned to this Recipe"
              >
                ✓
              </span>
            </Show>
            <Show when={p.record.isDefault}>
              <span
                class="profile-row__badge profile-row__badge--default"
                data-testid={`profile-row-${p.record.id}-default-badge`}
              >
                default
              </span>
            </Show>
          </div>
          <Show when={author()}>
            <div class="profile-row__author">{author()}</div>
          </Show>
        </div>
      </button>
    </li>
  );
};
