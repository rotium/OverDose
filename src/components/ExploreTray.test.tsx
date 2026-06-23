import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { ExploreTray } from './ExploreTray';
import type { Cleaning } from '../domain';

const cleaning = (id: string, name: string): Cleaning => ({
  id,
  name,
  operation: { kind: 'clean', steps: [] },
});

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

  it('disables water/flush with a droplet icon when blockReason is water-critical; brew + steam stay enabled', () => {
    const onSelect = vi.fn();
    render(() => (
      <ExploreTray
        onSelect={onSelect}
        blockReason={() => 'water-critical'}
      />
    ));
    // brew + steam open a prep screen, so their tiles stay navigable.
    expect(screen.getByTestId('explore-brew')).not.toBeDisabled();
    expect(screen.getByTestId('explore-steam')).not.toBeDisabled();
    for (const op of ['water', 'flush']) {
      const tile = screen.getByTestId(`explore-${op}`);
      expect(tile).toBeDisabled();
      expect(tile).toHaveAttribute('data-block-reason', 'water-critical');
      expect(screen.getByTestId(`explore-${op}-reason`)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId('explore-flush'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('disables water/flush with a power icon when blockReason is heater-off; brew + steam stay enabled', () => {
    render(() => (
      <ExploreTray
        onSelect={() => {}}
        blockReason={() => 'heater-off'}
      />
    ));
    for (const op of ['water', 'flush']) {
      const tile = screen.getByTestId(`explore-${op}`);
      expect(tile).toBeDisabled();
      expect(tile).toHaveAttribute('data-block-reason', 'heater-off');
    }
    // Brew + steam remain tappable — their prep screens do their own gating.
    expect(screen.getByTestId('explore-brew')).not.toBeDisabled();
    expect(screen.getByTestId('explore-steam')).not.toBeDisabled();
  });

  it('lets steam through to its prep screen even when blocked', () => {
    const onSelect = vi.fn();
    render(() => (
      <ExploreTray onSelect={onSelect} blockReason={() => 'heater-off'} />
    ));
    fireEvent.click(screen.getByTestId('explore-steam'));
    expect(onSelect).toHaveBeenCalledWith('steam');
  });

  it('is fully enabled by default (no blockReason)', () => {
    render(() => <ExploreTray onSelect={() => {}} />);
    for (const op of ['brew', 'steam', 'water', 'flush']) {
      expect(screen.getByTestId(`explore-${op}`)).not.toBeDisabled();
    }
  });

  describe('cleaning quick-launch tiles', () => {
    it('renders no cleaning tiles when none are passed', () => {
      render(() => <ExploreTray onSelect={() => {}} />);
      expect(screen.queryByTestId('explore-cleaning-c1')).not.toBeInTheDocument();
    });

    it('renders a tile per cleaning and launches its wizard on tap', () => {
      const onRunCleaning = vi.fn();
      render(() => (
        <ExploreTray
          onSelect={() => {}}
          cleanings={() => [cleaning('c1', 'Daily Rinse')]}
          onRunCleaning={onRunCleaning}
        />
      ));
      const tile = screen.getByTestId('explore-cleaning-c1');
      expect(tile).toHaveTextContent('Daily Rinse');
      fireEvent.click(tile);
      expect(onRunCleaning).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1' }),
      );
    });

    it('stays enabled even when the ops are blocked (it opens a wizard)', () => {
      render(() => (
        <ExploreTray
          onSelect={() => {}}
          blockReason={() => 'heater-off'}
          cleanings={() => [cleaning('c1', 'Daily Rinse')]}
        />
      ));
      expect(screen.getByTestId('explore-flush')).toBeDisabled();
      expect(screen.getByTestId('explore-cleaning-c1')).not.toBeDisabled();
    });

    it('highlights a due cleaning with the clock badge', () => {
      render(() => (
        <ExploreTray
          onSelect={() => {}}
          cleanings={() => [cleaning('c1', 'Daily Rinse')]}
          dueCleaningIds={() => new Set(['c1'])}
        />
      ));
      const tile = screen.getByTestId('explore-cleaning-c1');
      expect(tile).toHaveAttribute('data-due', 'true');
      expect(screen.getByTestId('explore-cleaning-c1-due')).toBeInTheDocument();
    });

    it('shows no due badge when not due', () => {
      render(() => (
        <ExploreTray
          onSelect={() => {}}
          cleanings={() => [cleaning('c1', 'Daily Rinse')]}
          dueCleaningIds={() => new Set()}
        />
      ));
      expect(screen.getByTestId('explore-cleaning-c1')).not.toHaveAttribute('data-due');
      expect(screen.queryByTestId('explore-cleaning-c1-due')).not.toBeInTheDocument();
    });
  });
});
