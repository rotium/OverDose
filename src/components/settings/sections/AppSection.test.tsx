import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@solidjs/testing-library';
import { AppSection } from './AppSection';
import type { GatewayInfo } from '../../../api';

const baseInfo: GatewayInfo = {
  commit: 'a1b2c3d4e5f6',
  commitShort: 'a1b2c3d',
  branch: 'main',
  buildTime: '2026-06-18T10:00:00Z',
  version: '0.7.6',
  buildNumber: '142',
  appStore: false,
  fullVersion: '0.7.6 (142)',
  localIp: '192.168.1.42',
};

// AppSection fetches gateway info from `/api/v1/info`. `info: null` simulates an
// unreachable gateway (the fetcher resolves to null).
const mkFetchMock = (info: GatewayInfo | null): ReturnType<typeof vi.fn> =>
  vi.fn().mockImplementation(() => {
    if (info === null) {
      return Promise.resolve(new Response('', { status: 500 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(info), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

describe('AppSection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the Skin build line (name, version, commit)', () => {
    vi.stubGlobal('fetch', mkFetchMock(baseInfo));
    render(() => <AppSection />);
    const text = (screen.getByTestId('app-version').textContent ?? '').trim();
    // e.g. "OverDose v0.0.1 · test" (version from package.json, commit injected)
    expect(text).toMatch(/^OverDose v\S+ · \S+$/);
  });

  it('renders Gateway version, commit·branch, build time, and IP', async () => {
    vi.stubGlobal('fetch', mkFetchMock(baseInfo));
    render(() => <AppSection />);

    await waitFor(() => screen.getByTestId('gateway-info-version'));
    expect(screen.getByTestId('gateway-info-version')).toHaveTextContent(
      '0.7.6 (142)',
    );
    expect(screen.getByTestId('gateway-info-commit')).toHaveTextContent(
      'a1b2c3d · main',
    );
    expect(screen.getByTestId('gateway-info-built')).toHaveTextContent(
      '2026-06-18T10:00:00Z',
    );
    expect(screen.getByTestId('gateway-info-ip')).toHaveTextContent(
      '192.168.1.42',
    );
  });

  it('shows "—" for an empty gateway IP', async () => {
    vi.stubGlobal('fetch', mkFetchMock({ ...baseInfo, localIp: '' }));
    render(() => <AppSection />);

    await waitFor(() => screen.getByTestId('gateway-info-ip'));
    expect(screen.getByTestId('gateway-info-ip')).toHaveTextContent('—');
  });

  it('falls back to "Gateway unavailable." when the gateway fetch fails, but still shows the skin', async () => {
    vi.stubGlobal('fetch', mkFetchMock(null));
    render(() => <AppSection />);

    await waitFor(() =>
      expect(screen.getByTestId('gateway-info-empty')).toHaveTextContent(
        'Gateway unavailable.',
      ),
    );
    expect(
      screen.queryByTestId('gateway-info-version'),
    ).not.toBeInTheDocument();
    // Skin subsection is static and unaffected by the gateway fetch.
    expect(screen.getByTestId('app-version')).toBeInTheDocument();
  });
});
