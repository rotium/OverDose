import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { Settings } from './Settings';
import { UserPrefsProvider, useUserPrefs } from '../../UserPrefsContext';
import { MemoryStorage } from '../../test/memoryStorage';
import { WithRepositories } from '../../test/repositories';
import { api } from '../../api';
import type { UserPrefsContextValue } from '../../UserPrefsContext';
import type { WsStream } from '../../streams';
import type { WaterLevelsSnapshot } from '../../snapshot';

// The Machine tab calls `GET /api/v1/machine/settings` on mount. jsdom's
// fetch chokes on relative URLs, so stub it for the whole Settings suite.
// Most tests here never click Machine, but Solid's <Switch> still mounts
// the matching arm and the resource fires regardless.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          fan: 50,
          usb: 'disable',
          flushTemp: 90,
          flushTimeout: 5,
          flushFlow: 4,
          hotWaterFlow: 4,
          steamFlow: 1.0,
          tankTemp: 25,
          steamPurgeMode: 0,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Harness {
  prefs: UserPrefsContextValue;
  onBack: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
}

const setup = (opts: { refillLevel?: number | null } = {}): Harness => {
  const onBack = vi.fn();
  const onClose = vi.fn();
  let capturedPrefs!: UserPrefsContextValue;

  // Critical = the machine's refill level, read from this stream. Provide a
  // refillLevel to render the Critical field; omit it (null) to exercise the
  // "no machine connected" placeholder.
  const [water] = createSignal<WaterLevelsSnapshot | null>(
    opts.refillLevel == null
      ? null
      : { currentLevel: 50, refillLevel: opts.refillLevel },
  );
  const waterLevelsStream: WsStream<WaterLevelsSnapshot> = {
    latest: water,
    status: createSignal<'open'>('open')[0],
  };

  const PrefsBridge = () => {
    capturedPrefs = useUserPrefs();
    return (
      <Settings
        onBack={onBack}
        onClose={onClose}
        waterLevelsStream={waterLevelsStream}
      />
    );
  };

  render(() => (
    <UserPrefsProvider storage={new MemoryStorage()}>
      <WithRepositories>
        <PrefsBridge />
      </WithRepositories>
    </UserPrefsProvider>
  ));

  return { prefs: capturedPrefs, onBack, onClose };
};

describe('Settings', () => {
  describe('header + close', () => {
    it('renders the title', () => {
      setup();
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    });

    it('back button invokes onBack', () => {
      const { onBack } = setup();
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      expect(onBack).toHaveBeenCalledOnce();
    });

    it('× button invokes onClose', () => {
      const { onClose } = setup();
      fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe('tabs', () => {
    it('starts on the Library tab', () => {
      setup();
      const tab = screen.getByRole('tab', { name: 'Library' });
      expect(tab).toHaveAttribute('aria-selected', 'true');
    });

    it('switches to Machine when clicked', () => {
      setup();
      fireEvent.click(screen.getByRole('tab', { name: 'Machine' }));
      expect(screen.getByRole('tab', { name: 'Machine' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    it('switches to Library when clicked and lands on Recipes subsection', async () => {
      setup();
      fireEvent.click(screen.getByRole('tab', { name: 'Library' }));
      expect(screen.getByRole('tab', { name: 'Library' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      // Library's default subsection is Recipes — the list renders from
      // the seeded LocalRecipeRepository in WithRepositories.
      await waitFor(() => screen.getByTestId('recipes-list'));
    });
  });

  describe('App tab — Display subsection', () => {
    it('starts on Display', () => {
      setup();
      fireEvent.click(screen.getByRole('tab', { name: 'App' }));
      expect(screen.getByRole('tab', { name: 'Display' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    it('changing water unit updates the context immediately', () => {
      const { prefs } = setup();
      fireEvent.click(screen.getByRole('tab', { name: 'App' }));
      fireEvent.click(screen.getByRole('radio', { name: 'mm' }));
      expect(prefs.waterUnit()).toBe('mm');
    });

    it('changing chart smoothing updates the context', () => {
      const { prefs } = setup();
      fireEvent.click(screen.getByRole('tab', { name: 'App' }));
      fireEvent.click(screen.getByRole('radio', { name: 'Spline' }));
      expect(prefs.chartSmoothing()).toBe('spline');
    });

    it('toggling a trace checkbox updates the context', () => {
      const { prefs } = setup();
      fireEvent.click(screen.getByRole('tab', { name: 'App' }));
      const before = prefs.traceVisibility().mixTemp;
      fireEvent.click(screen.getByRole('checkbox', { name: 'Mix temp' }));
      expect(prefs.traceVisibility().mixTemp).toBe(!before);
    });
  });

  describe('App tab — Alerts subsection', () => {
    const openAlerts = () => {
      // Library is the default tab now; navigate into App, then its Alerts
      // subsection.
      fireEvent.click(screen.getByRole('tab', { name: 'App' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Alerts' }));
    };

    it('updating the warn threshold persists the new value', () => {
      const { prefs } = setup();
      openAlerts();
      const input = screen.getByLabelText('Warn threshold') as HTMLInputElement;
      input.value = '8';
      fireEvent.change(input);
      expect(prefs.waterWarnMm()).toBe(8);
    });

    it('writes the critical threshold to the machine, clamped at/below warn', () => {
      const setRefill = vi
        .spyOn(api, 'setRefillLevel')
        .mockResolvedValue(undefined);
      const { prefs } = setup({ refillLevel: 3 }); // machine reports a level
      openAlerts();
      // warn defaults to 5, so trying to set critical to 9 should clamp to 5
      // and write that to the machine (not a skin pref).
      const crit = screen.getByLabelText('Critical threshold') as HTMLInputElement;
      // Debounced field: commit fires on input (debounced) + blur (flush).
      fireEvent.input(crit, { target: { value: '9' } });
      fireEvent.blur(crit);
      expect(setRefill).toHaveBeenCalledWith(prefs.waterWarnMm());
      setRefill.mockRestore();
    });

    it('clamps the warn threshold floor to the machine refill level', () => {
      const { prefs } = setup({ refillLevel: 3 }); // machine critical = 3 mm
      openAlerts();
      // Try to drop warn below the machine's refill level → clamps up to it.
      const warn = screen.getByLabelText('Warn threshold') as HTMLInputElement;
      warn.value = '1';
      fireEvent.change(warn);
      expect(prefs.waterWarnMm()).toBe(3);
    });

    it('shows a no-machine placeholder for critical when disconnected', () => {
      setup(); // no refill level
      openAlerts();
      expect(screen.getByTestId('critical-no-machine')).toBeInTheDocument();
      expect(
        screen.queryByLabelText('Critical threshold'),
      ).not.toBeInTheDocument();
    });
  });
});
