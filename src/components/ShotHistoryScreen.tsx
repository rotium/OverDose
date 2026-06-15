import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  type Accessor,
  type Component,
} from 'solid-js';
import type { TraceVisibility } from '../prefs';
import {
  api,
  type Bean,
  type GatewayShotRecord,
  type GatewayShotSummary,
  type ProfileRecord,
  type ShotListParams,
  type ShotPatch,
} from '../api';
import {
  shotDoseG,
  shotTargetYieldG,
  shotYieldG,
} from '../shotStats';
import { ShotRatingFace } from './ShotRatingFace';
import { PickerDialog } from './PickerDialog';
import { AutocompleteInput } from './settings/sections/library/AutocompleteInput';
import { ShotHistoryDetail } from './ShotHistoryDetail';

const PAGE = 20;

const fmtG = (n: number | null | undefined): string =>
  n == null || Number.isNaN(n) ? '—' : `${n.toFixed(1)} g`;

const fmtClock = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

const dayKey = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** "Today" / "Yesterday" / a date label, for the day-group section headers. */
const dayLabel = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  const today = new Date();
  const k = dayKey(iso);
  if (k === dayKey(today.toISOString())) return 'Today';
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  if (k === dayKey(yest.toISOString())) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

interface DaySection {
  key: string;
  label: string;
  shots: GatewayShotSummary[];
}

/** Group time-ordered (newest-first) shots into consecutive day sections. */
const groupByDay = (shots: GatewayShotSummary[]): DaySection[] => {
  const out: DaySection[] = [];
  for (const s of shots) {
    const k = dayKey(s.timestamp);
    const last = out[out.length - 1];
    if (last && last.key === k) last.shots.push(s);
    else out.push({ key: k, label: dayLabel(s.timestamp), shots: [s] });
  }
  return out;
};

const uniqSorted = (xs: string[]): string[] =>
  [...new Set(xs.filter((x) => x.trim()))].sort((a, b) => a.localeCompare(b));

const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

// Brew column = primary over a muted profile line. Primary is the recipe (how
// the user thinks of it); ad-hoc/Explore shots have no recipe, so the brew
// *type* (e.g. "Pourover", "Espresso") leads instead, with the profile still
// muted beneath. The profile title only becomes the primary if there's neither
// a recipe nor a declared type.
const brewPrimary = (s: GatewayShotSummary): string => {
  const recipe = s.workflow?.name?.trim();
  if (recipe) return recipe;
  const bev = s.workflow?.profile?.beverage_type?.trim();
  if (bev) return cap(bev);
  return s.workflow?.profile?.title?.trim() || 'Shot';
};
const brewSecondary = (s: GatewayShotSummary): string => {
  const recipe = s.workflow?.name?.trim();
  const bev = s.workflow?.profile?.beverage_type?.trim();
  // Show the profile beneath whenever the primary is a recipe or a type.
  return recipe || bev ? (s.workflow?.profile?.title?.trim() ?? '') : '';
};

const beanName = (s: GatewayShotSummary): string =>
  s.workflow?.context?.coffeeName?.trim() ?? '';
const beanRoaster = (s: GatewayShotSummary): string =>
  s.workflow?.context?.coffeeRoaster?.trim() ?? '';

/**
 * Shots history — full-bleed list of recorded shots with free-text search and
 * structured filters (bean / grinder / profile), grouped by day, paged via
 * infinite scroll. Selecting a row opens the detail (the shared ShotReview in
 * review mode). Grouping by a non-date field is deferred (needs server-side
 * sort the gateway lacks).
 */
export const ShotHistoryScreen: Component<{
  onClose: () => void;
  fetchShots?: (params: ShotListParams) => Promise<{
    items: GatewayShotSummary[];
    total: number;
  }>;
  fetchShot?: (id: string) => Promise<GatewayShotRecord>;
  updateShot?: (id: string, patch: ShotPatch) => Promise<void>;
  deleteShot?: (id: string) => Promise<void>;
  fetchBeans?: () => Promise<Bean[]>;
  fetchProfiles?: () => Promise<ProfileRecord[]>;
  /** Saved default trace visibility (Settings), seeding the detail chart. */
  traceVisibility?: Accessor<TraceVisibility>;
}> = (p) => {
  // ── Query state ──
  const [searchInput, setSearchInput] = createSignal('');
  const [search, setSearch] = createSignal('');
  // Bean filter is a specific bean (name + roaster) so same-named beans from
  // different roasters are distinguishable — the gateway filters on both.
  const [bean, setBean] = createSignal<{ name: string; roaster: string } | null>(
    null,
  );
  const [profile, setProfile] = createSignal('');
  // Grinder filter is hidden until grinders are a first-class entity elsewhere.
  const [filtersOpen, setFiltersOpen] = createSignal(false);

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  const onSearch = (v: string): void => {
    setSearchInput(v);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setSearch(v), 300);
  };
  onCleanup(() => clearTimeout(searchTimer));

  // ── Results (manual paging so pages accumulate across infinite scroll) ──
  const [items, setItems] = createSignal<GatewayShotSummary[]>([]);
  const [total, setTotal] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal(false);
  const [selected, setSelected] = createSignal<GatewayShotSummary | null>(null);
  let offset = 0;
  let reqSeq = 0;

  const params = (): ShotListParams => ({
    search: search().trim() || undefined,
    coffeeName: bean()?.name || undefined,
    coffeeRoaster: bean()?.roaster || undefined,
    profileTitle: profile() || undefined,
  });

  const load = async (reset: boolean): Promise<void> => {
    if (loading()) return;
    const seq = ++reqSeq;
    const base = reset ? 0 : offset;
    setLoading(true);
    try {
      const page = await (p.fetchShots ?? api.shotsList)({
        ...params(),
        limit: PAGE,
        offset: base,
      });
      if (seq !== reqSeq) return; // superseded by a newer query
      setError(false);
      setTotal(page.total);
      setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
      offset = base + page.items.length;
    } catch {
      if (seq === reqSeq) setError(true);
    } finally {
      if (seq === reqSeq) setLoading(false);
    }
  };

  // Reload from page 0 whenever the query changes (runs once on mount too).
  createEffect(on([search, bean, profile], () => void load(true)));

  const hasMore = (): boolean => items().length < total();
  const loadMore = (): void => {
    if (!loading() && hasMore()) void load(false);
  };

  // Auto-load the next page when the sentinel scrolls into view. Re-observed
  // via the ref callback so it survives the list ↔ detail swap. Guarded for
  // jsdom (no IntersectionObserver) — the Load-more button is the fallback.
  let io: IntersectionObserver | undefined;
  const sentinelRef = (el: HTMLDivElement): void => {
    if (typeof IntersectionObserver === 'undefined') return;
    io?.disconnect();
    io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: '240px' },
    );
    io.observe(el);
  };
  onCleanup(() => io?.disconnect());

  const sections = createMemo(() => groupByDay(items()));

  // ── Filter suggestions ──
  const [beans] = createResource(() => (p.fetchBeans ?? (() => api.beans({})))());
  const [profiles] = createResource(() =>
    (p.fetchProfiles ?? (() => api.profiles()))(),
  );
  // Bean options carry roaster + name; the dropdown shows "Roaster — Name"
  // (matching BeanPicker), mapped back to {name, roaster} on selection.
  const beanLabel = (b: { name: string; roaster: string } | null): string =>
    b ? (b.roaster ? `${b.roaster} — ${b.name}` : b.name) : '';
  const beanOptions = createMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ label: string; name: string; roaster: string }> = [];
    for (const b of beans() ?? []) {
      if (!b.name?.trim()) continue;
      const label = beanLabel({ name: b.name, roaster: b.roaster ?? '' });
      if (seen.has(label)) continue;
      seen.add(label);
      out.push({ label, name: b.name, roaster: b.roaster ?? '' });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  });
  const beanSuggestions = createMemo(() => beanOptions().map((o) => o.label));
  const profileSuggestions = createMemo(() =>
    uniqSorted((profiles() ?? []).map((r) => r.profile.title ?? '')),
  );
  // Drinker names already seen in the loaded shots — feeds the detail's "For"
  // autocomplete without an extra fetch.
  const drinkerSuggestions = createMemo(() =>
    uniqSorted(items().map((s) => s.workflow?.context?.drinkerName ?? '')),
  );

  const activeFilters = createMemo(() => {
    const out: Array<{ key: string; label: string; clear: () => void }> = [];
    if (bean()) out.push({ key: 'coffee', label: `Bean: ${beanLabel(bean())}`, clear: () => setBean(null) });
    if (profile()) out.push({ key: 'profile', label: `Profile: ${profile()}`, clear: () => setProfile('') });
    return out;
  });
  const clearAll = (): void => {
    setBean(null);
    setProfile('');
  };

  const rowYield = (s: GatewayShotSummary): number | null =>
    shotYieldG(s, null) ?? shotTargetYieldG(s);

  const onUpdated = (shot: GatewayShotSummary): void => {
    setItems((prev) => prev.map((s) => (s.id === shot.id ? shot : s)));
    setSelected((cur) => (cur && cur.id === shot.id ? shot : cur));
  };

  const onDeleted = (id: string): void => {
    setItems((prev) => prev.filter((s) => s.id !== id));
    setTotal((t) => Math.max(0, t - 1));
    offset = Math.max(0, offset - 1);
    setSelected(null);
  };

  return (
    <div class="shot-history" data-testid="shot-history">
      <Show
        when={!selected()}
        fallback={
          <ShotHistoryDetail
            shot={selected()!}
            onBack={() => setSelected(null)}
            onUpdated={onUpdated}
            onDeleted={onDeleted}
            traceVisibility={p.traceVisibility}
            drinkerSuggestions={drinkerSuggestions}
            fetchShot={p.fetchShot}
            updateShot={p.updateShot}
            deleteShot={p.deleteShot}
          />
        }
      >
        <header class="shot-history__head">
          <button
            type="button"
            class="btn shot-history__back"
            data-testid="shot-history-back"
            onClick={p.onClose}
          >
            ‹ Back
          </button>
          <h1 class="shot-history__title">Shots</h1>
          <span class="shot-history__count" data-testid="shot-history-count">
            {total()} {total() === 1 ? 'shot' : 'shots'}
          </span>
        </header>

        <div class="shot-history__toolbar">
          <input
            type="search"
            class="shot-history__search"
            placeholder="Search bean, roaster, notes…"
            aria-label="Search shots"
            data-testid="shot-history-search"
            value={searchInput()}
            onInput={(e) => onSearch(e.currentTarget.value)}
          />
          <button
            type="button"
            class="btn shot-history__filters-btn"
            data-testid="shot-history-filters"
            aria-haspopup="dialog"
            onClick={() => setFiltersOpen(true)}
          >
            ⚙ Filters
            <Show when={activeFilters().length > 0}>
              <span class="shot-history__badge" data-testid="shot-history-filter-badge">
                {activeFilters().length}
              </span>
            </Show>
          </button>
        </div>

        <Show when={activeFilters().length > 0}>
          <div class="shot-history__chips" data-testid="shot-history-chips">
            <For each={activeFilters()}>
              {(f) => (
                <button
                  type="button"
                  class="chip"
                  data-testid={`shot-history-chip-${f.key}`}
                  onClick={f.clear}
                >
                  {f.label} <span aria-hidden="true">✕</span>
                </button>
              )}
            </For>
          </div>
        </Show>

        <div class="shot-history__list" data-testid="shot-history-list">
          <Show
            when={items().length > 0}
            fallback={
              <div class="shot-history__empty" data-testid="shot-history-empty">
                <Show
                  when={!loading()}
                  fallback={<p class="muted">Loading shots…</p>}
                >
                  <Show
                    when={!error()}
                    fallback={<p class="muted">Couldn’t load shots.</p>}
                  >
                    <p class="muted">No shots match.</p>
                  </Show>
                </Show>
              </div>
            }
          >
            <For each={sections()}>
              {(sec) => (
                <section class="shot-history__day">
                  <h2 class="shot-history__day-head">
                    <span>{sec.label}</span>
                    <span class="shot-history__day-count">
                      {sec.shots.length}{' '}
                      {sec.shots.length === 1 ? 'shot' : 'shots'}
                    </span>
                  </h2>
                  <ul class="shot-history__rows">
                    <For each={sec.shots}>
                      {(s) => (
                        <li>
                          <button
                            type="button"
                            class="shot-row"
                            data-testid="shot-row"
                            onClick={() => setSelected(s)}
                          >
                            <span class="shot-row__time">
                              {fmtClock(s.timestamp)}
                            </span>
                            <span class="shot-row__rating">
                              <ShotRatingFace
                                value={
                                  typeof s.annotations?.enjoyment === 'number'
                                    ? s.annotations.enjoyment
                                    : null
                                }
                                size={26}
                              />
                            </span>
                            <span class="shot-row__col">
                              <span class="shot-row__primary">
                                {brewPrimary(s)}
                              </span>
                              <Show when={brewSecondary(s)}>
                                <span class="shot-row__secondary">
                                  {brewSecondary(s)}
                                </span>
                              </Show>
                            </span>
                            <span class="shot-row__col">
                              <span class="shot-row__primary">
                                <Show
                                  when={beanName(s)}
                                  fallback={<span class="muted">No bean</span>}
                                >
                                  {beanName(s)}
                                </Show>
                              </span>
                              <Show when={beanRoaster(s)}>
                                <span class="shot-row__secondary">
                                  {beanRoaster(s)}
                                </span>
                              </Show>
                            </span>
                            <span class="shot-row__yield">
                              {fmtG(shotDoseG(s))} → {fmtG(rowYield(s))}
                            </span>
                            <span class="shot-row__chev" aria-hidden="true">
                              ›
                            </span>
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              )}
            </For>

            <div ref={sentinelRef} class="shot-history__sentinel" aria-hidden="true" />
            <Show when={hasMore()}>
              <button
                type="button"
                class="btn shot-history__more"
                data-testid="shot-history-load-more"
                disabled={loading()}
                onClick={loadMore}
              >
                {loading() ? 'Loading…' : 'Load more'}
              </button>
            </Show>
          </Show>
        </div>
      </Show>

      <PickerDialog
        open={filtersOpen()}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        testId="shot-filters"
        maxWidthPx={440}
        dismissibleOnBackdrop={true}
        overflowVisible={true}
        footer={
          <>
            <button
              type="button"
              class="btn"
              data-testid="shot-filters-clear"
              onClick={clearAll}
            >
              Clear all
            </button>
            <button
              type="button"
              class="btn btn--primary"
              data-testid="shot-filters-done"
              onClick={() => setFiltersOpen(false)}
            >
              Done
            </button>
          </>
        }
      >
        <div class="shot-filters">
          <label class="shot-filters__field">
            <span class="shot-filters__label">Bean</span>
            <AutocompleteInput
              value={beanLabel(bean())}
              suggestions={beanSuggestions()}
              onChange={(v) => {
                const opt = beanOptions().find((o) => o.label === v);
                setBean(opt ? { name: opt.name, roaster: opt.roaster } : null);
              }}
              placeholder="All beans"
              ariaLabel="Filter by bean"
              testId="shot-filter-bean"
              class="shot-filters__input"
            />
          </label>
          <label class="shot-filters__field">
            <span class="shot-filters__label">Profile</span>
            <AutocompleteInput
              value={profile()}
              suggestions={profileSuggestions()}
              onChange={(v) =>
                setProfile(profileSuggestions().includes(v) ? v : '')
              }
              placeholder="All profiles"
              ariaLabel="Filter by profile"
              testId="shot-filter-profile"
              class="shot-filters__input"
            />
          </label>
        </div>
      </PickerDialog>
    </div>
  );
};
