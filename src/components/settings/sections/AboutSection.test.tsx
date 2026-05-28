import { render, screen } from '@solidjs/testing-library';
import { AboutSection } from './AboutSection';

describe('AboutSection', () => {
  it('renders the app name, version, and build commit', () => {
    render(() => <AboutSection />);
    const text = (screen.getByTestId('app-version').textContent ?? '').trim();
    // e.g. "OverDose v0.0.1 · test" (version from package.json, commit injected)
    expect(text).toMatch(/^OverDose v\S+ · \S+$/);
  });
});
