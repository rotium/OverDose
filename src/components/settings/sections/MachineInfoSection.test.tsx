import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@solidjs/testing-library';
import { MachineInfoSection } from './MachineInfoSection';
import type { MachineInfo } from '../../../api';

const baseInfo: MachineInfo = {
  version: '1.4.7',
  model: 'DE1+',
  serialNumber: 'D1A23F',
  GHC: false,
  extra: {},
};

// `info: null` simulates a disconnected machine — the gateway errors
// `/machine/info` and the fetcher resolves to null.
const mkFetchMock = (info: MachineInfo | null): ReturnType<typeof vi.fn> =>
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

describe('MachineInfoSection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders identity rows from the machineInfo fetch', async () => {
    vi.stubGlobal('fetch', mkFetchMock(baseInfo));
    render(() => <MachineInfoSection />);

    await waitFor(() => screen.getByTestId('machine-info-model'));
    expect(screen.getByTestId('machine-info-model')).toHaveTextContent('DE1+');
    expect(screen.getByTestId('machine-info-firmware')).toHaveTextContent(
      '1.4.7',
    );
    expect(screen.getByTestId('machine-info-serial')).toHaveTextContent(
      'D1A23F',
    );
  });

  it('shows the GHC pill as "Not present" by default', async () => {
    vi.stubGlobal('fetch', mkFetchMock(baseInfo));
    render(() => <MachineInfoSection />);

    await waitFor(() => screen.getByTestId('machine-info-ghc'));
    const pill = screen.getByTestId('machine-info-ghc');
    expect(pill).toHaveTextContent('Not present');
    expect(pill).not.toHaveClass('machine-info-pill--yes');
  });

  it('shows the GHC pill as "Present" when GHC is true', async () => {
    vi.stubGlobal('fetch', mkFetchMock({ ...baseInfo, GHC: true }));
    render(() => <MachineInfoSection />);

    await waitFor(() => screen.getByTestId('machine-info-ghc'));
    const pill = screen.getByTestId('machine-info-ghc');
    expect(pill).toHaveTextContent('Present');
    expect(pill).toHaveClass('machine-info-pill--yes');
  });

  it('falls back to "No machine connected." when the info fetch fails', async () => {
    vi.stubGlobal('fetch', mkFetchMock(null));
    render(() => <MachineInfoSection />);

    await waitFor(() =>
      expect(screen.getByTestId('machine-info-empty')).toHaveTextContent(
        'No machine connected.',
      ),
    );
    expect(screen.queryByTestId('machine-info-model')).not.toBeInTheDocument();
  });
});
