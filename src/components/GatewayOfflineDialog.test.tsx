import { render, screen, fireEvent } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { GatewayOfflineDialog } from './GatewayOfflineDialog';

describe('GatewayOfflineDialog', () => {
  it('names the address it cannot reach', () => {
    // The one fact that separates a sleeping tablet from a wrong host or port.
    render(() => (
      <GatewayOfflineDialog
        origin="http://192.168.3.95:8080"
        lastConnected={() => null}
        onRetry={vi.fn()}
      />
    ));
    expect(screen.getByText('http://192.168.3.95:8080')).toBeInTheDocument();
    expect(screen.getByText(/Can't reach the gateway/)).toBeInTheDocument();
  });

  it('makes no guess at the cause', () => {
    // A dead socket can't tell a sleeping tablet from a crashed app from the
    // wrong network, so the copy must not speculate.
    const { container } = render(() => (
      <GatewayOfflineDialog
        origin="http://192.168.3.95:8080"
        lastConnected={() => null}
        onRetry={vi.fn()}
      />
    ));
    expect(container.textContent).not.toMatch(/asleep|restarting|network|crash/i);
  });

  it('says when the gateway was last reachable', () => {
    const at = new Date('2026-08-30T09:14:00').getTime();
    render(() => (
      <GatewayOfflineDialog
        origin="http://localhost:8080"
        lastConnected={() => at}
        onRetry={vi.fn()}
      />
    ));
    expect(screen.getByText(/Last connected/)).toBeInTheDocument();
  });

  it('omits the last-connected line when it never connected', () => {
    render(() => (
      <GatewayOfflineDialog
        origin="http://localhost:8080"
        lastConnected={() => null}
        onRetry={vi.fn()}
      />
    ));
    expect(screen.queryByText(/Last connected/)).toBeNull();
  });

  it('says it is retrying on its own, so the button reads as a shortcut', () => {
    render(() => (
      <GatewayOfflineDialog
        origin="http://localhost:8080"
        lastConnected={() => null}
        onRetry={vi.fn()}
      />
    ));
    expect(screen.getByText(/Retrying automatically/)).toBeInTheDocument();
  });

  it('invokes onRetry when the button is pressed', () => {
    const onRetry = vi.fn();
    render(() => (
      <GatewayOfflineDialog
        origin="http://localhost:8080"
        lastConnected={() => null}
        onRetry={onRetry}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('says so when the address is the dev proxy rather than the gateway', () => {
    // Otherwise it claims Decaid lives on the Vite port — wrong in exactly the
    // case a developer is most likely to hit.
    render(() => (
      <GatewayOfflineDialog
        origin="http://localhost:5173"
        proxied
        lastConnected={() => null}
        onRetry={vi.fn()}
      />
    ));
    expect(screen.getByText(/dev proxy/)).toBeInTheDocument();
    expect(screen.getByText(/No response from the gateway behind/)).toBeInTheDocument();
  });

  it('names Decaid directly when talking to the gateway', () => {
    render(() => (
      <GatewayOfflineDialog
        origin="http://192.168.3.95:8080"
        lastConnected={() => null}
        onRetry={vi.fn()}
      />
    ));
    expect(screen.getByText(/No response from Decaid at/)).toBeInTheDocument();
    expect(screen.queryByText(/dev proxy/)).toBeNull();
  });

  it('is announced as a modal alert', () => {
    render(() => (
      <GatewayOfflineDialog
        origin="http://localhost:8080"
        lastConnected={() => null}
        onRetry={vi.fn()}
      />
    ));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });
});
