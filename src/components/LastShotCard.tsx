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
import { DEFAULT_TRACE_VISIBILITY, type TraceKey, type TraceVisibility } from '../prefs';
import { ShotMiniChart } from './ShotMiniChart';
import { ShotChartOverlay } from './ShotChartOverlay';
import {
  shotDoseG,
  shotDurationSec,
  shotHeadline,
  shotSubtitle,
  shotYieldG,
  shotTargetYieldG,
} from '../shotStats';

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
  /** Saved default trace visibility (Settings) so the mini chart matches the
   *  user's configured traces. Omitted → all traces show. */
  traceVisibility?: Accessor<TraceVisibility>;
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

  // Dose / yield / headline / subtitle come from the shared shotStats
  // helpers so this card and the post-brew summary never drift. The card
  // shows a single yield value, so it collapses actual→target (measured
  // value if present, else the configured target).
  const dose = () => shotDoseG(displayedSummary());
  const yieldG = () =>
    shotYieldG(displayedSummary(), displayedFull()) ??
    shotTargetYieldG(displayedSummary());
  const headlineName = () => shotHeadline(displayedSummary());
  const subtitleLine = () => shotSubtitle(displayedSummary());

  // Full-mode overlay. The overlay's trace visibility is INDEPENDENT of the
  // tile's: the tile keeps rendering at the saved defaults, while the overlay
  // gets its own session-local copy so toggling traces there never reshapes
  // the little card behind it. Reseeded from the saved defaults each time the
  // overlay opens, so it always starts from a clean, predictable state.
  const [expanded, setExpanded] = createSignal(false);
  const [overlayVis, setOverlayVis] = createSignal<TraceVisibility>(
    p.traceVisibility?.() ?? DEFAULT_TRACE_VISIBILITY,
  );
  const openOverlay = (): void => {
    setOverlayVis(p.traceVisibility?.() ?? DEFAULT_TRACE_VISIBILITY);
    setExpanded(true);
  };
  const toggleOverlayTrace = (key: TraceKey): void => {
    setOverlayVis((v) => ({ ...v, [key]: !v[key] }));
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
              <div class="last-shot__chart">
                <button
                  type="button"
                  class="icon-btn shot-review__expand"
                  aria-label="Enlarge chart"
                  data-testid="last-shot-chart-expand"
                  onClick={openOverlay}
                >
                  ⤢
                </button>
                <ShotMiniChart
                  shot={displayedFull}
                  fill
                  visibility={p.traceVisibility}
                  stepBoundaries={true}
                />
              </div>
              <p class="muted">{fmtAgo(s().timestamp, new Date(now()))}</p>
            </div>
          )}
        </Match>
      </Switch>

      <ShotChartOverlay
        open={expanded()}
        onClose={() => setExpanded(false)}
        title={headlineName()}
        shot={displayedFull}
        visibility={overlayVis}
        onToggle={toggleOverlayTrace}
      />
    </section>
  );
};
