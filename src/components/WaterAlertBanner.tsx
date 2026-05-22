import { Show, type Accessor, type Component } from 'solid-js';
import type { WaterSeverity } from '../water';
import { WaterDropIcon } from './icons';

/**
 * Full-width strip pinned at the bottom of the Home screen. Surfaces low-water
 * state with longer-form copy so the user gets the full message even if they
 * miss the header pill or the inline indicator inside the StatusPanel.
 *
 * Hidden when severity is 'normal' — the banner occupies layout space only
 * when something needs the user's attention.
 */
export interface WaterAlertBannerProps {
  severity: Accessor<WaterSeverity>;
}

const COPY: Record<Exclude<WaterSeverity, 'normal'>, string> = {
  warn: 'Water is low — refill the tank soon to keep brewing.',
  critical: 'Refill the water tank to continue. Brewing is paused.',
};

export const WaterAlertBanner: Component<WaterAlertBannerProps> = (p) => (
  <Show when={p.severity() !== 'normal'}>
    <div
      class="water-banner"
      data-severity={p.severity()}
      role="status"
      data-testid="water-alert-banner"
    >
      <WaterDropIcon size={20} />
      <span>{COPY[p.severity() as 'warn' | 'critical']}</span>
    </div>
  </Show>
);
