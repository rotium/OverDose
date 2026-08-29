import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';
import type { WsStatus } from './streams';

/**
 * Grace window before a dropped gateway is treated as an outage. Long enough
 * to ride out a gateway restart or a tablet deploy — those heal themselves
 * within a reconnect or two, and flashing an alarming dialog for a blip that
 * fixes itself trains people to ignore it.
 */
export const GATEWAY_GRACE_MS = 4_000;

export interface GatewayOutage {
  /** The gateway has been unreachable for longer than the grace window. */
  lost: Accessor<boolean>;
  /** Wall-clock ms of the last time the socket was open; null if never. */
  lastConnected: Accessor<number | null>;
}

/**
 * Track whether the gateway itself has gone away, as opposed to a device
 * detaching from it.
 *
 * Driven by the `ws/v1/devices` socket, which doubles as the gateway
 * heartbeat: it is the one socket that has to be up for anything on screen to
 * mean something, so a separate health check would only add a second way to be
 * wrong.
 *
 * Event-driven — one timer armed on the drop, cleared on recovery. Nothing
 * polls, and there is no timer at all while the gateway is healthy.
 */
export function createGatewayOutage(
  status: Accessor<WsStatus>,
  graceMs: number = GATEWAY_GRACE_MS,
): GatewayOutage {
  const [lost, setLost] = createSignal(false);
  const [lastConnected, setLastConnected] = createSignal<number | null>(null);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  createEffect(() => {
    // Depends on `status` alone — reading `lost()` here would re-trigger the
    // effect on its own write.
    const s = status();
    clear();
    if (s === 'open') {
      setLastConnected(Date.now());
      setLost(false); // recovery dismisses the dialog on its own
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      setLost(true);
    }, graceMs);
  });

  onCleanup(clear);

  return { lost, lastConnected };
}
