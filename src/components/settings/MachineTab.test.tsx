import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { MachineTab } from './MachineTab';
import type { MachineSettingsSnapshot } from '../../api';

const baseSettings: MachineSettingsSnapshot = {
  fan: 50,
  usb: 'disable',
  flushTemp: 90,
  flushTimeout: 5,
  flushFlow: 4,
  hotWaterFlow: 4,
  steamFlow: 1.2,
  tankTemp: 25,
  steamPurgeMode: 0,
};

const mkFetchMock = (
  initial: MachineSettingsSnapshot = baseSettings,
): ReturnType<typeof vi.fn> => {
  return vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    // POST handler: capture the body and resolve.
    if (init?.method === 'POST') {
      return Promise.resolve(new Response('', { status: 202 }));
    }
    // GET handler: return current snapshot.
    return Promise.resolve(
      new Response(JSON.stringify(initial), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
};

describe('MachineTab — steam flow', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mkFetchMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows loading copy while machine settings are fetching', () => {
    render(() => <MachineTab />);
    expect(screen.getByTestId('machine-settings-loading')).toBeInTheDocument();
  });

  it('renders the slider with the fetched steamFlow once loaded', async () => {
    render(() => <MachineTab />);
    await waitFor(() =>
      expect(screen.queryByTestId('machine-settings-loading')).not.toBeInTheDocument(),
    );
    const slider = screen.getByTestId('machine-steam-flow') as HTMLInputElement;
    expect(slider.value).toBe('1.2');
    expect(screen.getByTestId('machine-steam-flow-value')).toHaveTextContent(
      '1.2 mL/s',
    );
  });

  it('POSTs a sparse partial when the slider changes', async () => {
    const fetchMock = mkFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    render(() => <MachineTab />);
    await waitFor(() => screen.getByTestId('machine-steam-flow'));

    const slider = screen.getByTestId('machine-steam-flow') as HTMLInputElement;
    slider.value = '1.6';
    fireEvent.input(slider);
    fireEvent.pointerUp(slider); // flushes immediately

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      const init = postCall![1] as RequestInit;
      expect(init.body).toBe(JSON.stringify({ steamFlow: 1.6 }));
    });
  });

  it('shows an error message if the GET fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 500 })),
    );
    render(() => <MachineTab />);
    await waitFor(() =>
      expect(screen.getByTestId('machine-settings-loading')).toHaveTextContent(
        'Could not load machine settings.',
      ),
    );
  });
});
