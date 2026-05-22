import type { Accessor, Component } from 'solid-js';
import type { WsStatus } from '../streams';

/**
 * Top-of-screen header. Contains:
 *   - product title
 *   - machine + scale connection pills (driven by WS status signals)
 *   - menu button — opens the drawer with libraries/settings
 *   - sleep button — rightmost; puts the machine into sleeping state
 *
 * Connection pills are visible at all times; sleep is the only action available
 * from the header itself. All routing/library access is funnelled through the
 * menu so the header stays uncluttered.
 */
export interface HeaderProps {
  machineStatus: Accessor<WsStatus>;
  scaleStatus: Accessor<WsStatus>;
  onMenu: () => void;
  onSleep: () => void;
}

const PILL_LABEL: Record<WsStatus, string> = {
  connecting: '…',
  open: 'online',
  closed: 'offline',
};

export const Header: Component<HeaderProps> = (p) => (
  <header class="app-header">
    <h1 class="app-title">Decent.app</h1>
    <div class="app-header__pills">
      <span class="conn" data-state={p.machineStatus()}>
        machine · {PILL_LABEL[p.machineStatus()]}
      </span>
      <span class="conn" data-state={p.scaleStatus()}>
        scale · {PILL_LABEL[p.scaleStatus()]}
      </span>
    </div>
    <div class="app-header__actions">
      <button type="button" class="icon-btn" aria-label="Menu" onClick={p.onMenu}>
        ☰
      </button>
      <button type="button" class="icon-btn" aria-label="Sleep" onClick={p.onSleep}>
        zZz
      </button>
    </div>
  </header>
);
