import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { SleepOverlay } from './SleepOverlay';

describe('SleepOverlay', () => {
  it('renders the moon glyph and a tap-to-wake hint when active', () => {
    render(() => <SleepOverlay active={() => true} onWake={() => {}} />);
    const overlay = screen.getByTestId('sleep-overlay');
    expect(overlay).toHaveTextContent('Tap to wake');
    expect(overlay.querySelector('svg')).toBeInTheDocument();
  });

  it('exposes an accessible "Wake machine" label', () => {
    render(() => <SleepOverlay active={() => true} onWake={() => {}} />);
    expect(screen.getByRole('button', { name: 'Wake machine' })).toBeInTheDocument();
  });

  it('is not rendered while the machine is awake', () => {
    render(() => <SleepOverlay active={() => false} onWake={() => {}} />);
    expect(screen.queryByTestId('sleep-overlay')).not.toBeInTheDocument();
  });

  it('wakes on tap anywhere (a native button, so Enter/Space wake too)', () => {
    const onWake = vi.fn();
    render(() => <SleepOverlay active={() => true} onWake={onWake} />);
    fireEvent.click(screen.getByTestId('sleep-overlay'));
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  describe('enter / leave', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('enters with data-state="entering"', () => {
      render(() => <SleepOverlay active={() => true} onWake={() => {}} />);
      expect(screen.getByTestId('sleep-overlay')).toHaveAttribute(
        'data-state',
        'entering',
      );
    });

    it('on wake, fades out (data-state="leaving") then unmounts', async () => {
      const [active, setActive] = createSignal(true);
      render(() => <SleepOverlay active={active} onWake={() => {}} />);
      expect(screen.getByTestId('sleep-overlay')).toBeInTheDocument();

      // Machine wakes — the veil should fade out, not snap away.
      setActive(false);
      expect(screen.getByTestId('sleep-overlay')).toHaveAttribute(
        'data-state',
        'leaving',
      );

      vi.advanceTimersByTime(600);
      await waitFor(() =>
        expect(screen.queryByTestId('sleep-overlay')).not.toBeInTheDocument(),
      );
    });
  });
});
