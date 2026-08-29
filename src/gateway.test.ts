import { describe, expect, it } from 'vitest';
import { gatewayWsOrigin, resolveGatewayOriginFrom } from './gateway';

/** A page served by the gateway's skin server (any host, any port). */
const served = { protocol: 'http:', hostname: '192.168.3.95' };

describe('resolveGatewayOriginFrom', () => {
  it('addresses the API on :8080 when the page is served by the gateway', () => {
    // Decaid >=0.8.2 serves the skin from a fresh ephemeral port, so the API
    // is never same-origin. The page's own port is not an input here at all.
    expect(resolveGatewayOriginFrom(served, false)).toBe('http://192.168.3.95:8080');
  });

  it('carries the page protocol through', () => {
    expect(resolveGatewayOriginFrom({ protocol: 'https:', hostname: 'de1.local' }, false)).toBe(
      'https://de1.local:8080',
    );
  });

  it('resolves same-origin in dev so the Vite proxy stays in charge', () => {
    expect(resolveGatewayOriginFrom({ protocol: 'http:', hostname: 'localhost' }, true)).toBe('');
  });

  it('lets an explicit override win over both dev and gateway-served', () => {
    expect(resolveGatewayOriginFrom(served, false, 'http://10.0.0.5:8080')).toBe(
      'http://10.0.0.5:8080',
    );
    expect(resolveGatewayOriginFrom(served, true, 'http://10.0.0.5:8080')).toBe(
      'http://10.0.0.5:8080',
    );
  });

  it('strips a trailing slash from an override', () => {
    expect(resolveGatewayOriginFrom(served, false, 'http://10.0.0.5:8080/')).toBe(
      'http://10.0.0.5:8080',
    );
  });

  it('resolves to nothing without a location and without an override', () => {
    expect(resolveGatewayOriginFrom(undefined, false)).toBe('');
  });
});

describe('gatewayWsOrigin', () => {
  it('falls back to the page origin as ws:// when resolution is same-origin', () => {
    // Tests run in dev mode, i.e. the Vite-proxy branch.
    expect(gatewayWsOrigin()).toBe('ws://localhost');
  });
});
