import {
  Show,
  createEffect,
  createSignal,
  onCleanup,
  type Accessor,
  type Component,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import type { GatewayShotRecord } from '../api';
import type { TraceKey, TraceVisibility } from '../prefs';
import { ShotMiniChart } from './ShotMiniChart';
import { ShotChartLegend } from './ShotChartLegend';
import { deriveShotStats, shotReadoutAt } from '../shotStats';

/**
 * Full-mode chart review — a full-screen overlay with the shot curve enlarged,
 * the legend toggles, and a scrubbable crosshair driving a readout strip
 * (time + pressure/flow/temp/weight + current step). Touch-first: drag to move
 * the crosshair. Close with ✕, the backdrop, or Escape. Visibility is shared
 * with the inline review (same signal + toggle), so changes track in both.
 */
export const ShotChartOverlay: Component<{
  open: boolean;
  onClose: () => void;
  title: string;
  shot: Accessor<GatewayShotRecord | null>;
  visibility: Accessor<TraceVisibility>;
  onToggle: (key: TraceKey) => void;
}> = (p) => {
  const [hoverIdx, setHoverIdx] = createSignal<number | null>(null);

  // Readout follows the crosshair; with no hover, fall back to the shot's
  // end-of-shot summary so the strip always shows something meaningful.
  const readout = () => {
    const rec = p.shot();
    if (!rec) return null;
    const live = shotReadoutAt(rec, hoverIdx());
    if (live) return { ...live, live: true };
    const s = deriveShotStats(rec, rec);
    return {
      timeSec: s.durationSec ?? 0,
      pressure: null,
      flow: null,
      mixTemp: null,
      weight: s.yieldG,
      stepName: null,
      live: false,
    };
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && p.open) {
      e.preventDefault();
      e.stopImmediatePropagation();
      p.onClose();
    }
  };
  createEffect(() => {
    if (p.open) {
      window.addEventListener('keydown', onKey, true);
      onCleanup(() => window.removeEventListener('keydown', onKey, true));
    }
  });

  return (
    <Show when={p.open}>
      <Portal>
        <div
          class="shot-chart-overlay__backdrop"
          data-testid="shot-chart-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) p.onClose();
          }}
        >
          <div class="shot-chart-overlay" role="dialog" aria-modal="true" aria-label="Shot chart">
            <header class="shot-chart-overlay__head">
              <span class="shot-chart-overlay__title">{p.title}</span>
              <button
                type="button"
                class="picker-dialog__close"
                aria-label="Close chart"
                data-testid="shot-chart-overlay-close"
                onClick={p.onClose}
              >
                ×
              </button>
            </header>

            <ShotChartLegend
              visibility={p.visibility}
              onToggle={p.onToggle}
              testIdPrefix="shot-full"
            />

            <div class="shot-chart-overlay__chart">
              <ShotMiniChart
                shot={p.shot}
                fill
                showAxes
                cursor
                cursorFlags
                stepBoundaries
                visibility={p.visibility}
                onHover={setHoverIdx}
              />
            </div>

            {/* Per-trace values ride the curves as flags and time rides the
                crosshair foot; only the active step lives in a fixed footer. */}
            <div class="shot-chart-overlay__footer" data-testid="shot-full-readout">
              <Show when={readout()?.stepName}>
                <span class="shot-chart-overlay__foot-item">
                  <span class="shot-chart-overlay__foot-label">Step</span>
                  <span class="shot-chart-overlay__foot-value">{readout()!.stepName}</span>
                </span>
              </Show>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
};
