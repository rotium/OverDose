import {
  Match,
  Show,
  Switch,
  createResource,
  createSignal,
  onCleanup,
  type Accessor,
  type Component,
} from 'solid-js';
import type { GatewayShotRecord, GatewayShotSummary } from '../api';
import { ShotMiniChart } from './ShotMiniChart';

const fmtAgo = (timestamp: string, now: Date = new Date()): string => {
  const then = new Date(timestamp);
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
};

const shotDurationSec = (rec: GatewayShotRecord | null | undefined): number | null => {
  if (!rec || rec.measurements.length < 2) return null;
  const first = rec.measurements[0]!.machine.timestamp;
  const last = rec.measurements[rec.measurements.length - 1]!.machine.timestamp;
  return Math.round((Date.parse(last) - Date.parse(first)) / 1000);
};

/**
 * LastShotCard — compact display of the most recently completed shot. Loads
 * the summary (no measurements) for the headline stats, then lazy-loads the
 * full record for the mini chart. Both fetches are routed through injected
 * fetchers so the test suite never hits the network.
 */
export interface LastShotCardProps {
  fetchSummary: () => Promise<GatewayShotSummary>;
  fetchFull: (id: string) => Promise<GatewayShotRecord>;
  onSeeAll: () => void;
  /**
   * Optional reactivity hook — when this accessor's value changes, both the
   * summary and (transitively, via summary.id) the full-record fetches re-run.
   * The intended driver is "brew complete": Home tracks machine-state
   * transitions and bumps a counter when `espresso` exits, so the card
   * surfaces the freshly-recorded shot without a page refresh.
   * Initial value should be truthy or this won't fetch on mount.
   */
  refreshKey?: Accessor<unknown>;
  /**
   * Optimistic in-memory record assembled from the LiveShot accumulator the
   * instant a brew ends — paints immediately so the user doesn't stare at
   * the previous shot while the gateway's `/shots/latest` catches up (~3 s
   * race). Once the API returns a summary with timestamp ≥ this record's,
   * the gateway version takes over.
   */
  optimisticShot?: Accessor<GatewayShotRecord | null>;
}

/**
 * Wraps a fetcher so a rejected promise resolves to `null` rather than
 * propagating as a Solid resource error. The UI treats "no last shot" and
 * "fetch failed" identically, so this collapses the state machine and keeps
 * the test surface from hitting Solid's unhandled-rejection paths in jsdom.
 */
const safe = <A, T>(fn: (a: A) => Promise<T>) => async (a: A): Promise<T | null> => {
  try {
    return await fn(a);
  } catch {
    return null;
  }
};

export const LastShotCard: Component<LastShotCardProps> = (p) => {
  // Live "now" — drives the relative-time label so "just now" actually
  // transitions to "1 min ago", "2 min ago", etc. as time passes. 30 s
  // tick is twice the minimum useful resolution (a minute boundary can
  // be missed by at most 30 s). Cleaned up on unmount so we're not
  // leaking timers across drawer cycles.
  const [now, setNow] = createSignal(Date.now());
  const tick = setInterval(() => setNow(Date.now()), 30_000);
  onCleanup(() => clearInterval(tick));

  // Track refreshKey as the resource's source so the fetch re-runs whenever
  // the parent bumps it. Fall back to `1` (truthy constant) when no key is
  // wired in, which preserves the original "fetch once on mount" behaviour.
  const refreshSource = () => p.refreshKey?.() ?? 1;
  const [summary] = createResource<GatewayShotSummary | null, unknown>(
    refreshSource,
    safe<unknown, GatewayShotSummary>(() => p.fetchSummary()),
  );
  const [full] = createResource<GatewayShotRecord | null, string>(
    () => summary()?.id,
    safe<string, GatewayShotRecord>((id) => p.fetchFull(id)),
  );

  /**
   * Reconcile the optimistic and gateway sources. The optimistic record wins
   * until the gateway has caught up — detected by comparing timestamps. We
   * don't compare ids because the optimistic record uses a synthetic id, but
   * the start timestamp is captured from the same machine snapshot the
   * gateway persists.
   */
  const usingOptimistic = (): boolean => {
    const opt = p.optimisticShot?.();
    if (!opt) return false;
    const s = summary();
    if (!s) return true;
    return Date.parse(s.timestamp) < Date.parse(opt.timestamp);
  };

  const displayedSummary = (): GatewayShotSummary | null => {
    if (usingOptimistic()) {
      const opt = p.optimisticShot!()!;
      return {
        id: opt.id,
        timestamp: opt.timestamp,
        workflow: opt.workflow,
        annotations: opt.annotations,
      };
    }
    return summary() ?? null;
  };

  const displayedFull = (): GatewayShotRecord | null =>
    usingOptimistic() ? p.optimisticShot!() : full() ?? null;

  /**
   * Dose / yield fallback chain. Reaprime only populates
   * `annotations.actualDoseWeight/actualYield` via import parsers or
   * manual history edits — freshly-recorded shots leave them null. The
   * configured values live in `workflow.context.target*` and that's where
   * we have to read them for any shot the gateway just persisted. Order:
   * user-entered actual → workflow target → last scale weight (yield only).
   */
  const lastScaleWeight = (): number | null => {
    const ms = displayedFull()?.measurements;
    if (!ms?.length) return null;
    for (let i = ms.length - 1; i >= 0; i--) {
      const w = ms[i]?.scale?.weight;
      if (typeof w === 'number' && !Number.isNaN(w)) return w;
    }
    return null;
  };

  const dose = () =>
    displayedSummary()?.annotations?.actualDoseWeight ??
    displayedSummary()?.workflow?.context?.targetDoseWeight ??
    null;
  const yieldG = () =>
    displayedSummary()?.annotations?.actualYield ??
    lastScaleWeight() ??
    displayedSummary()?.workflow?.context?.targetYield ??
    null;
  /**
   * Headline = profile title (`Gentle and Sweet`) when present; otherwise
   * fall back to the workflow's user-facing name (`Cappuccino`), then to
   * a generic `Shot`. The profile name is what tells you "*how* this shot
   * was pulled"; the workflow name is just the recipe slot.
   */
  const headlineName = () =>
    displayedSummary()?.workflow?.profile?.title ??
    displayedSummary()?.workflow?.name ??
    displayedSummary()?.workflow?.context?.coffeeName ??
    'Shot';

  /**
   * Subtitle = recipe slot + bean name when the headline is the profile.
   * Without this the recipe/bean info gets dropped from the card entirely
   * once a shot has profile metadata. Returns the empty string when there's
   * nothing useful to add (the headline is already the recipe name, or
   * neither recipe nor bean is set).
   */
  const subtitleLine = (): string => {
    const s = displayedSummary();
    if (!s?.workflow) return '';
    const profileTitle = s.workflow.profile?.title ?? '';
    const recipeName = s.workflow.name ?? '';
    const coffeeName = s.workflow.context?.coffeeName ?? '';
    // Headline is already the recipe name (profile missing) — nothing to
    // add unless bean is interesting.
    if (!profileTitle) {
      return recipeName && coffeeName && coffeeName !== recipeName
        ? coffeeName
        : '';
    }
    const parts: string[] = [];
    if (recipeName) parts.push(recipeName);
    if (coffeeName && coffeeName !== recipeName) parts.push(coffeeName);
    return parts.join(' · ');
  };

  return (
    <section class="card last-shot">
      <header class="last-shot__head">
        <h2>Last shot</h2>
        <button type="button" class="link" onClick={p.onSeeAll}>
          → all
        </button>
      </header>

      <Switch>
        <Match when={summary.loading && !usingOptimistic()}>
          <p class="muted">loading…</p>
        </Match>
        <Match when={displayedSummary() === null}>
          <p class="muted" role="alert">
            no shot yet
          </p>
        </Match>
        <Match when={displayedSummary()}>
          {(s) => (
            <div class="last-shot__body" data-source={usingOptimistic() ? 'optimistic' : 'gateway'}>
              <p class="last-shot__name">{headlineName()}</p>
              <Show when={subtitleLine()}>
                <p
                  class="last-shot__subtitle"
                  data-testid="last-shot-subtitle"
                >
                  {subtitleLine()}
                </p>
              </Show>
              <p class="last-shot__stats" data-testid="last-shot-stats">
                <Show when={dose() != null && yieldG() != null} fallback={<span>—</span>}>
                  <span>
                    {dose()!.toFixed(1)}g → {yieldG()!.toFixed(1)}g
                  </span>
                </Show>
                <Show when={shotDurationSec(displayedFull()) != null}>
                  <span> · {shotDurationSec(displayedFull())}s</span>
                </Show>
              </p>
              <ShotMiniChart shot={displayedFull} />
              <p class="muted">{fmtAgo(s().timestamp, new Date(now()))}</p>
            </div>
          )}
        </Match>
      </Switch>
    </section>
  );
};
