declare global {
  interface Window {
    OVERDOSE_GATEWAY?: string;
  }
}

function resolveGatewayOrigin(): string {
  const override = typeof window !== 'undefined' ? window.OVERDOSE_GATEWAY : undefined;
  if (override) return override.replace(/\/$/, '');
  if (typeof location === 'undefined') return '';
  if (location.port === '3000') {
    return `${location.protocol}//${location.hostname}:8080`;
  }
  return '';
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
