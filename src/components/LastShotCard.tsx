import {
  Match,
  Show,
  Switch,
  createResource,
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

const peakPressure = (rec: GatewayShotRecord | null | undefined): number | null => {
  if (!rec?.measurements.length) return null;
  let peak = 0;
  for (const m of rec.measurements) {
    if (m.machine.pressure > peak) peak = m.machine.pressure;
  }
  return peak;
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
  const [summary] = createResource<GatewayShotSummary | null>(
    safe<unknown, GatewayShotSummary>(() => p.fetchSummary()),
  );
  const [full] = createResource<GatewayShotRecord | null, string>(
    () => summary()?.id,
    safe<string, GatewayShotRecord>((id) => p.fetchFull(id)),
  );

  const dose = () => summary()?.annotations?.actualDoseWeight ?? null;
  const yieldG = () => summary()?.annotations?.actualYield ?? null;
  const beverageName = () =>
    summary()?.workflow?.name ?? summary()?.workflow?.context?.coffeeName ?? 'Shot';

  return (
    <section class="card last-shot">
      <header class="last-shot__head">
        <h2>Last shot</h2>
        <button type="button" class="link" onClick={p.onSeeAll}>
          → all
        </button>
      </header>

      <Switch>
        <Match when={summary.loading}>
          <p class="muted">loading…</p>
        </Match>
        <Match when={summary() === null}>
          <p class="muted" role="alert">
            no shot yet
          </p>
        </Match>
        <Match when={summary()}>
          {(s) => (
            <div class="last-shot__body">
              <p class="last-shot__name">{beverageName()}</p>
              <p class="last-shot__stats" data-testid="last-shot-stats">
                <Show when={dose() != null && yieldG() != null} fallback={<span>—</span>}>
                  <span>
                    {dose()!.toFixed(1)}g → {yieldG()!.toFixed(1)}g
                  </span>
                </Show>
                <Show when={shotDurationSec(full()) != null}>
                  <span> · {shotDurationSec(full())}s</span>
                </Show>
                <Show when={peakPressure(full()) != null}>
                  <span> · {peakPressure(full())!.toFixed(1)} bar peak</span>
                </Show>
              </p>
              <ShotMiniChart shot={() => full() ?? null} />
              <p class="muted">{fmtAgo(s().timestamp)}</p>
            </div>
          )}
        </Match>
      </Switch>
    </section>
  );
};
