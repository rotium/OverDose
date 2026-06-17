import {
  Show,
  createEffect,
  onCleanup,
  type Accessor,
  type Component,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import type { GatewayShotRecord } from '../api';
import type { TraceKey, TraceVisibility } from '../prefs';
import { ShotMiniChart } from './ShotMiniChart';
import { ShotChartLegend } from './ShotChartLegend';

/**
 * Full-mode chart review — a full-screen overlay with the shot curve enlarged
 * and the legend toggles. A scrubbable crosshair drives the on-chart readouts:
 * each trace's value rides its curve as a flag, time rides the crosshair foot,
 * and the current profile step is highlighted among the boundary labels.
 * Touch-first: drag to move the crosshair. Close with ✕, the backdrop, or
 * Escape. Visibility is shared with the inline review, so changes track in both.
 */
export const ShotChartOverlay: Component<{
  open: boolean;
  onClose: () => void;
  title: string;
  shot: Accessor<GatewayShotRecord | null>;
  visibility: Accessor<TraceVisibility>;
  onToggle: (key: TraceKey) => void;
}> = (p) => {
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
              />
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
};
