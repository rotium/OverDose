import { describe, expect, it } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { WaterAlertBanner } from './WaterAlertBanner';
import type { WaterSeverity } from '../water';

const setup = (initial: WaterSeverity = 'normal') => {
  const [sev, setSev] = createSignal<WaterSeverity>(initial);
  render(() => <WaterAlertBanner severity={sev} />);
  return { setSev };
};

describe('WaterAlertBanner', () => {
  it('is hidden when severity is normal', () => {
    setup('normal');
    expect(screen.queryByTestId('water-alert-banner')).not.toBeInTheDocument();
  });

  it('renders a warn banner with informational copy', () => {
    setup('warn');
    const banner = screen.getByTestId('water-alert-banner');
    expect(banner).toHaveAttribute('data-severity', 'warn');
    expect(banner).toHaveTextContent(/water is low/i);
  });

  it('renders a critical banner with blocking copy', () => {
    setup('critical');
    const banner = screen.getByTestId('water-alert-banner');
    expect(banner).toHaveAttribute('data-severity', 'critical');
    expect(banner).toHaveTextContent(/brewing is paused/i);
  });

  it('reacts to severity signal changes', () => {
    const { setSev } = setup('normal');
    setSev('warn');
    expect(screen.getByTestId('water-alert-banner')).toBeInTheDocument();
    setSev('critical');
    expect(screen.getByTestId('water-alert-banner')).toHaveAttribute(
      'data-severity',
      'critical',
    );
    setSev('normal');
    expect(screen.queryByTestId('water-alert-banner')).not.toBeInTheDocument();
  });
});
