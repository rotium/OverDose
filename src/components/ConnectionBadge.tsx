import type { Accessor, Component } from 'solid-js';
import type { WsStatus } from '../streams';

const LABEL: Record<WsStatus, string> = {
  connecting: 'connecting…',
  open: 'connected',
  closed: 'disconnected',
};

export const ConnectionBadge: Component<{ status: Accessor<WsStatus> }> = (p) => (
  <div class="conn" data-state={p.status()}>
    {LABEL[p.status()]}
  </div>
);
