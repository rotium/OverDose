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

  it('disables every tile when `disabled` is true (e.g. low water)', () => {
    const onSelect = vi.fn();
    render(() => <ExploreTray onSelect={onSelect} disabled={() => true} />);
    for (const op of ['brew', 'steam', 'water', 'flush']) {
      expect(screen.getByTestId(`explore-${op}`)).toBeDisabled();
    }
    fireEvent.click(screen.getByTestId('explore-flush'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('is enabled by default (no `disabled` prop)', () => {
    render(() => <ExploreTray onSelect={() => {}} />);
    expect(screen.getByTestId('explore-brew')).not.toBeDisabled();
  });
});
