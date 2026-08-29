declare global {
  interface Window {
    OVERDOSE_GATEWAY?: string;
  }
}

/**
 * The gateway's REST/WebSocket port. Hard-coded on the gateway side too —
 * `webserver_service.dart` binds 8080 with no CLI flag, setting, or env
 * override — and a served skin is told nothing about it: the injected
 * `/__decent/skin-api.js` only exposes the account-proxy token and the
 * dashboard-exit callback, both pointing at the *skin* origin. Every other
 * skin hardcodes 8080 for the same reason.
 */
const GATEWAY_PORT = 8080;

/**
 * Decide where the gateway API lives, given the page's location.
 *
 * Exported for tests — callers want {@link gatewayHttpOrigin} /
 * {@link gatewayWsOrigin}.
 *
 * Dev is the only case that resolves to same-origin: under `npm run dev` Vite
 * proxies `/api` and `/ws` to GATEWAY_HOST, so returning "" keeps that proxy —
 * and the `GATEWAY_HOST=<tablet-ip>:8080 npm run dev` workflow — in charge.
 *
 * Everywhere else the page is served by something that is *not* the API, so we
 * address the API explicitly on its own port. Note the page's own port is
 * deliberately not consulted: Decaid >=0.8.2 serves each skin from a fresh
 * ephemeral port (which changes on every restart) and leaves :3000 as a
 * redirect to it, so the port we happen to be served from says nothing about
 * where the API is. Keying off `port === '3000'` is what broke this before —
 * it left every request pointed at the static file server, which 404s.
 */
export function resolveGatewayOriginFrom(
  loc: { protocol: string; hostname: string } | undefined,
  isDev: boolean,
  override?: string,
): string {
  if (override) return override.replace(/\/$/, '');
  if (!loc || isDev) return '';
  return `${loc.protocol}//${loc.hostname}:${GATEWAY_PORT}`;
}

function resolveGatewayOrigin(): string {
  return resolveGatewayOriginFrom(
    typeof location === 'undefined' ? undefined : location,
    import.meta.env.DEV,
    typeof window === 'undefined' ? undefined : window.OVERDOSE_GATEWAY,
  );
}

export function gatewayHttpOrigin(): string {
  return resolveGatewayOrigin();
}

export function gatewayWsOrigin(): string {
  const origin = resolveGatewayOrigin();
  if (origin) return origin.replace(/^http/, 'ws');
  if (typeof location === 'undefined') return '';
  return location.origin.replace(/^http/, 'ws');
}
