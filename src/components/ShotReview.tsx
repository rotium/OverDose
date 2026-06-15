import {
  For,
  Show,
  createMemo,
  createSignal,
  type Accessor,
  type Component,
  type JSX,
} from 'solid-js';
import {
  type GatewayShotRecord,
  type GatewayShotSummary,
} from '../api';
import { ShotRatingFace } from './ShotRatingFace';
import { ShotMiniChart } from './ShotMiniChart';
import { deriveShotStats } from '../shotStats';
import { TRACE_COLOR } from './chartTraces';
import {
  DEFAULT_TRACE_VISIBILITY,
  type TraceKey,
  type TraceVisibility,
} from '../prefs';
import { DebouncedNumberField } from './settings/sections/library/DebouncedNumberField';

export const fmtStat = (
  n: number | null | undefined,
  digits: number,
  unit: string,
): string =>
  n === null || n === undefined || Number.isNaN(n)
    ? '—'
    : `${n.toFixed(digits)}${unit}`;

/** Estimate-tagged variant of {@link fmtStat} — prefixes `~` when a value
 *  is present (e.g. the no-scale "In cup" volume, which is flow-derived). */
export const fmtEst = (
  n: number | null | undefined,
  digits: number,
  unit: string,
): string => {
  const v = fmtStat(n, digits, unit);
  return v === '—' ? v : `~${v}`;
};

/** Legend trace declarations for the shot chart — mirrors the live view's
 *  legend (minus the dashed-targets entry, which the frozen record can't
 *  supply). Colours come from `chartTraces.ts` so they never drift. */
const RESULT_LEGEND: Array<{
  key: TraceKey;
  name: string;
  color: string;
  suffix?: string;
}> = [
  { key: 'pressure', name: 'pressure', color: TRACE_COLOR.pressure },
  { key: 'flow', name: 'flow', color: TRACE_COLOR.flow },
  { key: 'weightFlow', name: 'weight flow', color: TRACE_COLOR.weightFlow },
  { key: 'weight', name: 'weight', color: TRACE_COLOR.weight, suffix: '÷10' },
  { key: 'mixTemp', name: 'mix temp', color: TRACE_COLOR.mixTemperature, suffix: '÷10' },
];

/** A compact stat row on the Shot Review rail: a small label with its value
 *  (string or custom content, e.g. the editable dose field) and an optional
 *  muted target sub-line — actual and target shown as separate values, never
 *  an `actual/target` fraction (per the agreed result-screen treatment). */
const ReviewStat: Component<{
  label: string;
  testId: string;
  sub?: string;
  children: JSX.Element;
}> = (p) => (
  <div class="rstat" data-testid={p.testId}>
    <dt class="rstat__label">{p.label}</dt>
    <dd class="rstat__value">{p.children}</dd>
    <Show when={p.sub}>
      <dd class="rstat__sub" data-testid={`${p.testId}-target`}>{p.sub}</dd>
    </Show>
  </div>
);

/**
 * Presentational shot-review shell shared by the post-brew result and the
 * shots-history detail. It renders the headline, the stat grid, the
 * rate/notes annotation fields, and the curve with a toggleable legend — but
 * owns no sourcing or persistence. The annotation fields are *controlled*
 * (value + setter come from the parent) so each host decides the save model:
 *
 *  - post-brew → always editable, debounced auto-save (`editable` always true);
 *  - history   → read-only until an explicit Edit toggle flips `editable`.
 *
 * Layout: post-brew lays the data/rate/notes out in a row with the chart
 * full-width *below* (the chart is the hero continuation of the live view).
 * History (`chartSide`) stacks data/rate/notes/Delete in a left column with
 * the chart in a second column on the right.
 *
 * Slots let each host place its own chrome: `headerLeading` (e.g. a back
 * chevron), `headerActions` (save-state vs Edit/Save/Cancel), `belowStats`
 * (e.g. a Delete button) and `footer` (e.g. Done / Brew again).
 */
export const ShotReview: Component<{
  summary: Accessor<GatewayShotSummary | null>;
  full: Accessor<GatewayShotRecord | null>;
  /** True while the summary is still loading → shows "Loading shot…". */
  loading?: Accessor<boolean>;
  /** When false the annotation fields render as read-only text. */
  editable: Accessor<boolean>;
  // Controlled annotation fields.
  enjoyment: Accessor<number | null>;
  onEnjoyment: (v: number) => void;
  notes: Accessor<string>;
  onNotes: (v: string) => void;
  actualDose: Accessor<number | undefined>;
  onActualDose: (v: number | undefined) => void;
  /** Debounce for the dose field's commit (host decides; 0 = immediate). */
  doseDebounceMs?: number;
  /** Two-column layout with the chart on the right (history detail). When
   *  false/omitted, the chart sits full-width below (post-brew). */
  chartSide?: boolean;
  /** Hide the headline's subtitle (e.g. when the coffee moves into a
   *  left-column section instead of the header). */
  hideSubtitle?: boolean;
  // Chrome slots.
  headerLeading?: JSX.Element;
  headerActions?: JSX.Element;
  /** Rendered at the top of the data column (e.g. the editable Coffee
   *  section on the history detail). */
  leadingLeft?: JSX.Element;
  belowStats?: JSX.Element;
  footer?: JSX.Element;
  /** Prefixes every data-testid; defaults to the post-brew naming so the
   *  existing post-brew tests keep matching. */
  testIdPrefix?: string;
}> = (p) => {
  const tid = (s: string): string => `${p.testIdPrefix ?? 'post-brew'}-${s}`;

  const stats = createMemo(() => deriveShotStats(p.summary(), p.full()));
  const hasShot = (): boolean => p.summary() !== null;
  const displayDose = (): number | null | undefined =>
    p.actualDose() ?? stats().doseG;

  // Per-session trace visibility for the legend show/hide. Starts all-on,
  // independent of the live view's prefs to keep the review self-contained.
  const [visibility, setVisibility] =
    createSignal<TraceVisibility>(DEFAULT_TRACE_VISIBILITY);
  const toggleTrace = (key: TraceKey): void => {
    setVisibility({ ...visibility(), [key]: !visibility()[key] });
  };

  // Dose — the one editable number. Stays with the editable fields.
  const doseStat = (): JSX.Element => (
    <ReviewStat label="Dose" testId={tid('stat-dose')}>
      <Show
        when={p.editable()}
        fallback={
          <span data-testid={tid('dose-value')}>
            {fmtStat(displayDose(), 1, ' g')}
          </span>
        }
      >
        <span class="rstat__edit">
          <DebouncedNumberField
            value={p.actualDose()}
            onCommit={(v) => p.onActualDose(v)}
            min={0}
            step={0.1}
            ariaLabel="Actual dose, grams"
            testId={tid('dose-input')}
            class="rstat__input"
            debounceMs={p.doseDebounceMs}
          />
          <span class="rstat__unit">g</span>
        </span>
      </Show>
    </ReviewStat>
  );

  // Read-only facts — what the machine recorded. Never editable.
  const factStats = (): JSX.Element => (
    <>
      <ReviewStat
        label="Yield"
        testId={tid('stat-yield')}
        sub={
          stats().targetYieldG != null
            ? `target ${fmtStat(stats().targetYieldG, 1, ' g')}`
            : undefined
        }
      >
        {fmtStat(stats().yieldG, 1, ' g')}
      </ReviewStat>
      <ReviewStat label="Time" testId={tid('time')}>
        {fmtStat(stats().durationSec, 0, ' s')}
      </ReviewStat>
      <ReviewStat label="Peak P" testId={tid('stat-peak-pressure')}>
        {fmtStat(stats().peakPressureBar, 1, ' bar')}
      </ReviewStat>
      <ReviewStat label="Peak flow" testId={tid('stat-peak-flow')}>
        {fmtStat(stats().peakFlowMlS, 1, ' mL/s')}
      </ReviewStat>
      <ReviewStat
        label="Water"
        testId={tid('stat-volume')}
        sub={
          stats().targetVolumeMl != null
            ? `target ${fmtStat(stats().targetVolumeMl, 0, ' mL')}`
            : undefined
        }
      >
        {fmtStat(stats().volumeMl, 0, ' mL')}
      </ReviewStat>
      <Show when={stats().volumeCountStart != null}>
        <ReviewStat
          label="In cup"
          testId={tid('stat-counted-volume')}
          sub={`from step ${stats().volumeCountStart}`}
        >
          {fmtEst(stats().countedVolumeMl, 0, ' mL')}
        </ReviewStat>
      </Show>
    </>
  );

  // Post-brew shows dose + facts together in one rail.
  const statsBlock = (): JSX.Element => (
    <dl class="shot-review__stats" data-testid={tid('stats')}>
      {doseStat()}
      {factStats()}
    </dl>
  );

  const rateBlock = (): JSX.Element => (
    <div class="review-col review-col--rate">
      <span class="review-field__label">Rate</span>
      <div class="rating">
        <ShotRatingFace value={p.enjoyment()} />
        <Show when={p.editable()}>
          <input
            type="range"
            class="rating__slider"
            min="0"
            max="100"
            step="1"
            value={p.enjoyment() ?? 50}
            classList={{ 'rating__slider--unset': p.enjoyment() == null }}
            aria-label="Enjoyment rating, 0 to 100"
            data-testid={tid('rating')}
            onInput={(e) => p.onEnjoyment(Number(e.currentTarget.value))}
          />
        </Show>
        <div class="rating__value" data-testid={tid('rating-value')}>
          <Show
            when={p.enjoyment() != null}
            fallback={p.editable() ? 'Drag to rate' : 'Unrated'}
          >
            <span class="rating__num">{p.enjoyment()}</span>
            <span class="rating__den"> / 100</span>
          </Show>
        </div>
      </div>
    </div>
  );

  const notesBlock = (): JSX.Element => (
    <div class="review-col review-col--notes">
      <label class="review-field">
        <span class="review-field__label">Notes</span>
        <Show
          when={p.editable()}
          fallback={
            <p class="post-brew__notes-ro" data-testid={tid('notes-value')}>
              <Show
                when={p.notes().trim()}
                fallback={<span class="muted">No notes</span>}
              >
                {p.notes()}
              </Show>
            </p>
          }
        >
          <textarea
            class="post-brew__notes"
            rows="4"
            placeholder="Bright, jammy, a little sharp on the finish…"
            data-testid={tid('notes')}
            value={p.notes()}
            onInput={(e) => p.onNotes(e.currentTarget.value)}
          />
        </Show>
      </label>
      <Show when={p.editable()}>
        <button
          type="button"
          class="btn shot-review__viz"
          data-testid={tid('visualizer')}
          disabled
          title="Coming soon"
        >
          Upload to Visualizer
        </button>
      </Show>
    </div>
  );

  const chartBlock = (): JSX.Element => (
    <div class="shot-review__chart-wrap">
      <ul
        class="live-view__legend shot-review__legend"
        aria-label="Chart legend"
        data-testid={tid('legend')}
      >
        <For each={RESULT_LEGEND}>
          {(item) => {
            const isOn = createMemo(() => visibility()[item.key]);
            return (
              <li>
                <button
                  type="button"
                  class="legend-item"
                  classList={{ 'legend-item--hidden': !isOn() }}
                  aria-pressed={isOn()}
                  aria-label={`Toggle ${item.name} trace`}
                  data-testid={tid(`legend-${item.key}`)}
                  onClick={() => toggleTrace(item.key)}
                >
                  <span
                    class="legend-swatch"
                    style={{ background: item.color }}
                    aria-hidden="true"
                  />
                  <span class="legend-label">{item.name}</span>
                  <Show when={item.suffix}>
                    <span class="legend-suffix">{item.suffix}</span>
                  </Show>
                </button>
              </li>
            );
          }}
        </For>
      </ul>
      <div class="shot-review__chart" data-testid={tid('chart')}>
        <ShotMiniChart
          shot={p.full}
          fill={true}
          showAxes={true}
          visibility={visibility}
        />
      </div>
    </div>
  );

  return (
    <section class="shot-review" data-testid={tid('view')}>
      <div class="shot-review__scroll">
        <Show
          when={hasShot()}
          fallback={
            <div class="post-brew__empty">
              <p class="prep__no-params" data-testid={tid('empty')}>
                <Show when={p.loading?.()} fallback="No shot data recorded.">
                  Loading shot…
                </Show>
              </p>
            </div>
          }
        >
          <header class="shot-review__head">
            {p.headerLeading}
            {/* chartSide hosts the title as a chart caption on the right
                instead of here, leaving a thin back-only top bar. */}
            <Show when={!p.chartSide}>
              <div class="shot-review__title">
                <span
                  class="shot-review__profile"
                  data-testid={tid('headline')}
                >
                  {stats().headline}
                </span>
                <Show when={stats().subtitle && !p.hideSubtitle}>
                  <span
                    class="shot-review__subtitle"
                    data-testid={tid('subtitle')}
                  >
                    {stats().subtitle}
                  </span>
                </Show>
              </div>
            </Show>
            {p.headerActions}
          </header>

          {/* Post-brew: data │ rate │ notes in a row, chart full-width below.
              (Solid compiles these children into lazy getters, so only the
              active branch's blocks — and its single chart — are created.) */}
          <Show when={!p.chartSide}>
            <>
              {p.leadingLeft}
              <div class="shot-review__cols" data-testid={tid('capture')}>
                {statsBlock()}
                <div class="shot-review__divider" aria-hidden="true" />
                {rateBlock()}
                {notesBlock()}
              </div>
              {p.belowStats}
              {chartBlock()}
            </>
          </Show>

          {/* History detail: editable fields (+ actions) on the left; the
              recorded shot on the right — profile caption, curve, then the
              read-only facts beneath it. */}
          <Show when={p.chartSide}>
            <div class="shot-review__split" data-testid={tid('capture')}>
              <div class="shot-review__left">
                {p.leadingLeft}
                <dl class="shot-review__stats" data-testid={tid('stats')}>
                  {doseStat()}
                </dl>
                {rateBlock()}
                {notesBlock()}
                {p.belowStats}
              </div>
              <div class="shot-review__right">
                <div
                  class="shot-review__chart-title"
                  data-testid={tid('headline')}
                >
                  {stats().headline}
                </div>
                {chartBlock()}
                <dl class="shot-review__facts" data-testid={tid('facts')}>
                  {factStats()}
                </dl>
              </div>
            </div>
          </Show>
        </Show>
      </div>

      {p.footer}
    </section>
  );
};
