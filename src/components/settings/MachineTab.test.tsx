import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { MachineTab } from './MachineTab';
import type { MachineSettingsSnapshot } from '../../api';
import type { ShotSettingsSnapshot } from '../../snapshot';
import type { WsStream } from '../../streams';
import { UserPrefsProvider } from '../../UserPrefsContext';
import { MemoryStorage } from '../../test/memoryStorage';

// MachineTab reads the purge-strategy user pref, so it must render inside a
// UserPrefsProvider. A fresh in-memory store per render keeps tests isolated.
const renderTab = (ui: () => JSX.Element) =>
  render(() => (
    <UserPrefsProvider storage={new MemoryStorage()}>{ui()}</UserPrefsProvider>
  ));

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

const baseShot: ShotSettingsSnapshot = {
  steamSetting: 0,
  targetSteamTemp: 150,
  targetSteamDuration: 30,
  targetHotWaterTemp: 85,
  targetHotWaterVolume: 100,
  targetHotWaterDuration: 35,
  targetShotVolume: 36,
  groupTemp: 94,
};

const mkShotStream = (
  value: ShotSettingsSnapshot | null,
): WsStream<ShotSettingsSnapshot> => {
  const [latest] = createSignal<ShotSettingsSnapshot | null>(value);
  const [status] = createSignal<'open'>('open');
  return { latest, status };
};

describe('MachineTab — steam flow', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mkFetchMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows loading copy while machine settings are fetching', () => {
    renderTab(() => <MachineTab />);
    expect(screen.getByTestId('machine-settings-loading')).toBeInTheDocument();
  });

  it('renders the slider with the fetched steamFlow once loaded', async () => {
    renderTab(() => <MachineTab />);
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

    renderTab(() => <MachineTab />);
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
    renderTab(() => <MachineTab />);
    await waitFor(() =>
      expect(screen.getByTestId('machine-settings-loading')).toHaveTextContent(
        'Could not load machine settings.',
      ),
    );
  });
});

describe('MachineTab — steam purge strategy', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mkFetchMock());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to "firmware" with the delay slider hidden', async () => {
    renderTab(() => <MachineTab />);
    await waitFor(() =>
      screen.getByTestId('machine-steam-purge-strategy'),
    );
    const radios = screen
      .getByTestId('machine-steam-purge-strategy')
      .querySelectorAll('input[type="radio"]');
    const firmware = Array.from(radios).find(
      (r) => (r as HTMLInputElement).value === 'firmware',
    ) as HTMLInputElement;
    expect(firmware.checked).toBe(true);
    expect(
      screen.queryByTestId('machine-steam-autoflush'),
    ).not.toBeInTheDocument();
  });

  it('reveals the delay slider only for "autoFlush"', async () => {
    renderTab(() => <MachineTab />);
    await waitFor(() => screen.getByTestId('machine-steam-purge-strategy'));
    const autoFlush = screen.getByDisplayValue('autoFlush') as HTMLInputElement;
    fireEvent.click(autoFlush);
    expect(screen.getByTestId('machine-steam-autoflush')).toBeInTheDocument();

    const manual = screen.getByDisplayValue('manual') as HTMLInputElement;
    fireEvent.click(manual);
    expect(
      screen.queryByTestId('machine-steam-autoflush'),
    ).not.toBeInTheDocument();
  });
});

describe('MachineTab — flush defaults', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mkFetchMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the timeout + flow sliders with the fetched values once loaded', async () => {
    renderTab(() => <MachineTab />);
    await waitFor(() =>
      expect(screen.queryByTestId('machine-settings-loading')).not.toBeInTheDocument(),
    );
    const timeout = screen.getByTestId('machine-flush-timeout') as HTMLInputElement;
    expect(timeout.value).toBe('5');
    expect(timeout.min).toBe('3');
    expect(timeout.max).toBe('120');
    expect(screen.getByTestId('machine-flush-timeout-value')).toHaveTextContent('5 s');

    const flow = screen.getByTestId('machine-flush-flow') as HTMLInputElement;
    expect(flow.value).toBe('4');
    expect(flow.min).toBe('1');
    expect(flow.max).toBe('10');
    expect(screen.getByTestId('machine-flush-flow-value')).toHaveTextContent('4.0 mL/s');
  });

  it('POSTs a sparse partial when the timeout slider changes', async () => {
    const fetchMock = mkFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    renderTab(() => <MachineTab />);
    await waitFor(() => screen.getByTestId('machine-flush-timeout'));

    const slider = screen.getByTestId('machine-flush-timeout') as HTMLInputElement;
    slider.value = '30';
    fireEvent.input(slider);
    fireEvent.pointerUp(slider);

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      expect((postCall![1] as RequestInit).body).toBe(
        JSON.stringify({ flushTimeout: 30 }),
      );
    });
  });

  it('POSTs a sparse partial when the flow slider changes', async () => {
    const fetchMock = mkFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    renderTab(() => <MachineTab />);
    await waitFor(() => screen.getByTestId('machine-flush-flow'));

    const slider = screen.getByTestId('machine-flush-flow') as HTMLInputElement;
    slider.value = '7.5';
    fireEvent.input(slider);
    fireEvent.pointerUp(slider);

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      expect((postCall![1] as RequestInit).body).toBe(
        JSON.stringify({ flushFlow: 7.5 }),
      );
    });
  });
});

describe('MachineTab — steam temperature + duration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mkFetchMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the connect hint and no temp/duration sliders without a stream', async () => {
    renderTab(() => <MachineTab />);
    await waitFor(() =>
      expect(
        screen.queryByTestId('machine-settings-loading'),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('machine-steam-shotsettings-pending'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('machine-steam-temp')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('machine-steam-duration'),
    ).not.toBeInTheDocument();
  });

  it('renders the temp + duration sliders from the shotSettings frame', async () => {
    renderTab(() => <MachineTab shotSettingsStream={mkShotStream(baseShot)} />);
    await waitFor(() => screen.getByTestId('machine-steam-temp'));

    const temp = screen.getByTestId('machine-steam-temp') as HTMLInputElement;
    expect(temp.value).toBe('150');
    expect(temp.min).toBe('130');
    expect(temp.max).toBe('170');
    expect(screen.getByTestId('machine-steam-temp-value')).toHaveTextContent(
      '150 °C',
    );

    const dur = screen.getByTestId('machine-steam-duration') as HTMLInputElement;
    expect(dur.value).toBe('30');
    expect(dur.max).toBe('120');
    expect(
      screen.getByTestId('machine-steam-duration-value'),
    ).toHaveTextContent('30 s');
  });

  it('renders "Until stopped" when the steam duration is 0', async () => {
    renderTab(() => (
      <MachineTab
        shotSettingsStream={mkShotStream({ ...baseShot, targetSteamDuration: 0 })}
      />
    ));
    await waitFor(() => screen.getByTestId('machine-steam-duration'));
    expect(
      screen.getByTestId('machine-steam-duration-value'),
    ).toHaveTextContent('Until stopped');
  });

  it('POSTs the full shotSettings body with the overlaid duration', async () => {
    const fetchMock = mkFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    renderTab(() => <MachineTab shotSettingsStream={mkShotStream(baseShot)} />);
    await waitFor(() => screen.getByTestId('machine-steam-duration'));

    const dur = screen.getByTestId('machine-steam-duration') as HTMLInputElement;
    dur.value = '45';
    fireEvent.input(dur);
    fireEvent.pointerUp(dur);

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (call) =>
          (call[1] as RequestInit | undefined)?.method === 'POST' &&
          String(call[0]).includes('shotSettings'),
      );
      expect(postCall).toBeDefined();
      expect((postCall![1] as RequestInit).body).toBe(
        JSON.stringify({ ...baseShot, targetSteamDuration: 45 }),
      );
    });
  });
});
