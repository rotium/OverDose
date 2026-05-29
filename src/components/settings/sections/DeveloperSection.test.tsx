import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { DeveloperSection } from './DeveloperSection';
import { WithPrefs } from '../../../test/prefs';

const renderSection = () =>
  render(() => (
    <WithPrefs>
      <DeveloperSection />
    </WithPrefs>
  ));

describe('DeveloperSection', () => {
  it('shows the build identity (version / commit / build time)', () => {
    renderSection();
    expect(screen.getByTestId('dev-build')).toBeInTheDocument();
    // vitest.config injects 'test' for commit + build time.
    expect(screen.getByTestId('dev-build-commit')).toHaveTextContent('test');
    expect(screen.getByTestId('dev-build-time')).toHaveTextContent('test');
  });

  it('toggles the debug-logging pref', () => {
    renderSection();
    const cb = screen.getByTestId('pref-debug-logging') as HTMLInputElement;
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);
    expect(cb.checked).toBe(true);
  });

  it('reset asks for confirmation before wiping data', () => {
    renderSection();
    expect(screen.queryByTestId('reset-confirm')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('reset-app-data'));
    expect(screen.getByTestId('reset-confirm')).toBeInTheDocument();
    // Cancel backs out without reloading.
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByTestId('reset-confirm')).not.toBeInTheDocument();
  });
});
