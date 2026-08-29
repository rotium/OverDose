import { Show, type Accessor, type Component } from 'solid-js';
import { NoSignalIcon } from './icons';

export interface GatewayOfflineDialogProps {
  /** Where the app is sending its requests — the one fact that tells a
   *  sleeping tablet from a wrong host or port. */
  origin: string;
  /**
   * True when that address is the dev server rather than the gateway itself,
   * i.e. requests are same-origin and Vite forwards them to GATEWAY_HOST.
   * Without saying so the dialog claims Decaid lives on the Vite port, which
   * is exactly wrong in the case a developer is most likely to hit.
   */
  proxied?: boolean;
  /** Wall-clock ms of the last successful connection, or null if never. */
  lastConnected: Accessor<number | null>;
  /** Retry now. Reloads by default in App. */
  onRetry: () => void;
}

const clock = (ms: number): string =>
  new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Shown when the gateway itself is unreachable — not when a device detaches.
 *
 * In the app this is effectively unreachable: the skin is served *by* the
 * gateway, so if the gateway is gone the page is gone with it. It exists for
 * LAN access from a browser, and for dev, where the gateway is routinely down
 * before you start it.
 *
 * The copy deliberately makes no guess at the cause. A dead socket can't tell
 * a sleeping tablet from a crashed app from the wrong network, so listing
 * candidates would be inventing information — and the list could never be
 * complete. It states what is known: no response, from this address, since
 * this time.
 *
 * Note this cannot catch an *incompatible* gateway. A version mismatch answers
 * normally and returns the wrong shapes, so the sockets stay up and this never
 * fires; detecting that needs an explicit check against /api/v1/info.
 */
export const GatewayOfflineDialog: Component<GatewayOfflineDialogProps> = (p) => (
  <div class="gw-offline" data-testid="gateway-offline">
    <div
      class="gw-offline__dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="gw-offline-title"
    >
      <span class="gw-offline__icon">
        <NoSignalIcon size={20} />
      </span>
      <h2 class="gw-offline__title" id="gw-offline-title">
        Can't reach the gateway
      </h2>
      <p class="gw-offline__lede">
        {p.proxied ? 'No response from the gateway behind' : 'No response from Decaid at'}
      </p>
      <div class="gw-offline__origin">{p.origin}</div>
      <Show when={p.proxied}>
        <p class="gw-offline__since">
          Requests go through the dev proxy — check GATEWAY_HOST and the gateway
          it points at.
        </p>
      </Show>
      <Show when={p.lastConnected()}>
        {(at) => (
          <p class="gw-offline__since">Last connected {clock(at())}.</p>
        )}
      </Show>
      <span class="gw-offline__retrying">
        <span class="gw-offline__dot" />
        Retrying automatically…
      </span>
      <button
        type="button"
        class="btn btn--primary gw-offline__retry"
        onClick={() => p.onRetry()}
      >
        Retry now
      </button>
    </div>
  </div>
);
