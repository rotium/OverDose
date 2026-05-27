import { Show, type Accessor, type Component } from 'solid-js';
import type { WsStatus } from '../streams';
import type { WaterSeverity } from '../water';
import { MoonIcon, SunIcon, WaterDropIcon } from './icons';

/**
 * Top-of-screen header. Contains:
 *   - product title
 *   - machine + scale connection pills (driven by WS status signals)
 *   - low-water alert pill (visible when severity is warn/critical)
 *   - menu button — opens the drawer with libraries/settings
 *   - sleep/wake toggle button — rightmost; mirrors streamline.js behaviour
 *     (label flips between "Sleep" and "Awake", icon flips moon↔sun).
 *
 * Connection pills are visible at all times. All routing/library access is
 * funnelled through the menu so the header stays uncluttered.
 */
export interface HeaderProps {
  machineStatus: Accessor<WsStatus>;
  scaleStatus: Accessor<WsStatus>;
  waterSeverity: Accessor<WaterSeverity>;
  isSleeping: Accessor<boolean>;
  onMenu: () => void;
  /** Toggle handler — parent decides whether to sleep or wake based on isSleeping. */
  onToggleSleep: () => void;
}

const PILL_LABEL: Record<WsStatus, string> = {
  connecting: '…',
  open: 'online',
  closed: 'offline',
};

const WATER_PILL_LABEL: Record<Exclude<WaterSeverity, 'normal'>, string> = {
  warn: 'low water',
  critical: 'refill water',
};

export const Header: Component<HeaderProps> = (p) => (
  <header class="app-header">
    <h1 class="app-title">OverDose</h1>
    <div class="app-header__pills">
      <span class="conn" data-state={p.machineStatus()}>
        machine · {PILL_LABEL[p.machineStatus()]}
      </span>
      <span class="conn" data-state={p.scaleStatus()}>
        scale · {PILL_LABEL[p.scaleStatus()]}
      </span>
      <Show when={p.waterSeverity() !== 'normal'}>
        <span
          class="alert-pill"
          data-severity={p.waterSeverity()}
          role="status"
          data-testid="header-water-pill"
        >
          <WaterDropIcon size={14} />
          {WATER_PILL_LABEL[p.waterSeverity() as 'warn' | 'critical']}
        </span>
      </Show>
    </div>
    <div class="app-header__actions">
      <button type="button" class="icon-btn" aria-label="Menu" onClick={p.onMenu}>
        ☰
      </button>
      <button
        type="button"
        class="icon-btn icon-btn--labeled"
        data-state={p.isSleeping() ? 'sleeping' : 'awake'}
        aria-label={p.isSleeping() ? 'Wake machine' : 'Sleep'}
        aria-pressed={p.isSleeping()}
        onClick={p.onToggleSleep}
      >
        <Show when={p.isSleeping()} fallback={<MoonIcon size={16} />}>
          <SunIcon size={16} />
        </Show>
        <span>{p.isSleeping() ? 'Awake' : 'Sleep'}</span>
      </button>
    </div>
  </header>
);
