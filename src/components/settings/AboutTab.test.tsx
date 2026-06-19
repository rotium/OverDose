import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@solidjs/testing-library';
import { AboutTab } from './AboutTab';
import { UserPrefsProvider } from '../../UserPrefsContext';
import { MemoryStorage } from '../../test/memoryStorage';

// AboutTab stacks MachineInfoSection (fetches /machine/info), AppSection
// (Gateway subsection fetches /api/v1/info + static Skin info), and
// DeveloperSection (reads user prefs). Stub fetch URL-aware so each info call
// gets its own shape, and wrap in a fresh prefs provider.
const json = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

describe('AboutTab', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/api/v1/info')) {
          return json({
            commit: 'a1b2c3d4',
            commitShort: 'a1b2c3d',
            branch: 'main',
            buildTime: '2026-06-18T10:00:00Z',
            version: '0.7.6',
            buildNumber: '142',
            appStore: false,
            fullVersion: '0.7.6 (142)',
            localIp: '192.168.1.42',
          });
        }
        // /machine/info
        return json({
          version: '1.4.7',
          model: 'DE1+',
          serialNumber: 'D1A23F',
          GHC: false,
          extra: {},
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stacks the machine, app (gateway + skin), and developer sections', async () => {
    render(() => (
      <UserPrefsProvider storage={new MemoryStorage()}>
        <AboutTab />
      </UserPrefsProvider>
    ));

    // Machine identity (from MachineInfoSection, after its fetch resolves).
    await waitFor(() => screen.getByTestId('machine-info-model'));
    expect(screen.getByTestId('machine-info-model')).toHaveTextContent('DE1+');

    // App build info (from AboutSection).
    expect(screen.getByTestId('app-version')).toBeInTheDocument();

    // Gateway build info (from GatewayInfoSection, after its fetch resolves).
    await waitFor(() => screen.getByTestId('gateway-info-version'));
    expect(screen.getByTestId('gateway-info-version')).toHaveTextContent(
      '0.7.6 (142)',
    );

    // Developer tools (from DeveloperSection — its "Build" sub-heading).
    expect(screen.getByText('Build')).toBeInTheDocument();
  });
});
