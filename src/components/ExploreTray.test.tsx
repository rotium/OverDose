import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { ExploreTray } from './ExploreTray';

describe('ExploreTray', () => {
  it('renders the four machine ops', () => {
    render(() => <ExploreTray onSelect={() => {}} />);
    expect(screen.getByTestId('explore-brew')).toHaveTextContent('Brew');
    expect(screen.getByTestId('explore-steam')).toHaveTextContent('Steam');
    expect(screen.getByTestId('explore-water')).toHaveTextContent('Hot Water');
    expect(screen.getByTestId('explore-flush')).toHaveTextContent('Flush');
  });

  it('calls onSelect with the chosen op', () => {
    const onSelect = vi.fn();
    render(() => <ExploreTray onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('explore-steam'));
    expect(onSelect).toHaveBeenCalledWith('steam');
    fireEvent.click(screen.getByTestId('explore-brew'));
    expect(onSelect).toHaveBeenLastCalledWith('brew');
  });

  it('disables steam/water/flush with a droplet icon when blockReason is water-critical; brew stays enabled', () => {
    const onSelect = vi.fn();
    render(() => (
      <ExploreTray
        onSelect={onSelect}
        blockReason={() => 'water-critical'}
      />
    ));
    expect(screen.getByTestId('explore-brew')).not.toBeDisabled();
    for (const op of ['steam', 'water', 'flush']) {
      const tile = screen.getByTestId(`explore-${op}`);
      expect(tile).toBeDisabled();
      expect(tile).toHaveAttribute('data-block-reason', 'water-critical');
      expect(screen.getByTestId(`explore-${op}-reason`)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId('explore-flush'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('disables steam/water/flush with a power icon when blockReason is heater-off', () => {
    render(() => (
      <ExploreTray
        onSelect={() => {}}
        blockReason={() => 'heater-off'}
      />
    ));
    for (const op of ['steam', 'water', 'flush']) {
      const tile = screen.getByTestId(`explore-${op}`);
      expect(tile).toBeDisabled();
      expect(tile).toHaveAttribute('data-block-reason', 'heater-off');
    }
    // Brew remains tappable — its prep screen does its own heater-off gate.
    expect(screen.getByTestId('explore-brew')).not.toBeDisabled();
  });

  it('is fully enabled by default (no blockReason)', () => {
    render(() => <ExploreTray onSelect={() => {}} />);
    for (const op of ['brew', 'steam', 'water', 'flush']) {
      expect(screen.getByTestId(`explore-${op}`)).not.toBeDisabled();
    }
  });
});
