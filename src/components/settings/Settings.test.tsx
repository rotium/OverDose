import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { Settings } from './Settings';
import { UserPrefsProvider, useUserPrefs } from '../../UserPrefsContext';
import { MemoryStorage } from '../../test/memoryStorage';
import { WithRepositories } from '../../test/repositories';
import type { UserPrefsContextValue } from '../../UserPrefsContext';

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

const setup = (): Harness => {
  const onBack = vi.fn();
  const onClose = vi.fn();
  let capturedPrefs!: UserPrefsContextValue;

  const PrefsBridge = () => {
    capturedPrefs = useUserPrefs();
    return <Settings onBack={onBack} onClose={onClose} />;
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
    it('starts on the App tab', () => {
      setup();
      const tab = screen.getByRole('tab', { name: 'App' });
      expect(tab).toHaveAttribute('aria-selected', 'true');
    });

    it('switches to Gateway when clicked', () => {
      setup();
      fireEvent.click(screen.getByRole('tab', { name: 'Gateway' }));
      expect(screen.getByRole('tab', { name: 'Gateway' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByRole('tab', { name: 'App' })).toHaveAttribute(
        'aria-selected',
        'false',
      );
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
      expect(screen.getByRole('tab', { name: 'Display' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    it('changing water unit updates the context immediately', () => {
      const { prefs } = setup();
      fireEvent.click(screen.getByRole('radio', { name: 'mm' }));
      expect(prefs.waterUnit()).toBe('mm');
    });

    it('changing chart smoothing updates the context', () => {
      const { prefs } = setup();
      fireEvent.click(screen.getByRole('radio', { name: 'Spline' }));
      expect(prefs.chartSmoothing()).toBe('spline');
    });

    it('toggling a trace checkbox updates the context', () => {
      const { prefs } = setup();
      const before = prefs.traceVisibility().mixTemp;
      fireEvent.click(screen.getByRole('checkbox', { name: 'Mix temp' }));
      expect(prefs.traceVisibility().mixTemp).toBe(!before);
    });
  });

  describe('App tab — Alerts subsection', () => {
    const openAlerts = () =>
      fireEvent.click(screen.getByRole('tab', { name: 'Alerts' }));

    it('updating the warn threshold persists the new value', () => {
      const { prefs } = setup();
      openAlerts();
      const input = screen.getByLabelText('Warn threshold') as HTMLInputElement;
      input.value = '8';
      fireEvent.change(input);
      expect(prefs.waterWarnMm()).toBe(8);
    });

    it('clamps the critical threshold so it cannot exceed warn', () => {
      const { prefs } = setup();
      openAlerts();
      // warn defaults to 5, so trying to set critical to 9 should clamp to 5.
      const block = screen.getByLabelText('Critical threshold') as HTMLInputElement;
      block.value = '9';
      fireEvent.change(block);
      expect(prefs.waterBlockMm()).toBe(prefs.waterWarnMm());
    });

    it('clamps the warn threshold floor to the critical threshold', () => {
      const { prefs } = setup();
      openAlerts();
      // Set critical first so warn has a meaningful floor.
      const block = screen.getByLabelText('Critical threshold') as HTMLInputElement;
      block.value = '3';
      fireEvent.change(block);
      // Now try to drop warn below critical.
      const warn = screen.getByLabelText('Warn threshold') as HTMLInputElement;
      warn.value = '1';
      fireEvent.change(warn);
      expect(prefs.waterWarnMm()).toBe(prefs.waterBlockMm());
    });
  });
});
