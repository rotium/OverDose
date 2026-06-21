import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { BeansSection } from './BeansSection';
import type { Bean } from '../../../../api';

const mkBean = (over: Partial<Bean> = {}): Bean => ({
  id: over.id ?? 'b1',
  roaster: over.roaster ?? 'Square Mile',
  name: over.name ?? 'Red Brick',
  decaf: false,
  archived: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

describe('BeansSection', () => {
  it('groups beans into a roaster tree, alphabetically', async () => {
    const beans = [
      mkBean({ id: 'b1', roaster: 'Square Mile', name: 'Sweetshop' }),
      mkBean({ id: 'b2', roaster: 'Square Mile', name: 'Red Brick' }),
      mkBean({ id: 'b3', roaster: 'Has Bean', name: 'Jailbreak' }),
    ];
    render(() => <BeansSection loadBeans={async () => beans} />);
    await waitFor(() => screen.getByTestId('beans-tree'));

    const roasters = screen
      .getAllByText(/Square Mile|Has Bean/)
      .map((el) => el.textContent);
    expect(roasters).toEqual(['Has Bean', 'Square Mile']);

    // Both beans of the same roaster are present and reachable as rows.
    expect(screen.getByTestId('bean-row-b1')).toBeTruthy();
    expect(screen.getByTestId('bean-row-b2')).toBeTruthy();
    expect(screen.getByTestId('bean-row-b3')).toBeTruthy();
  });

  it('shows an empty state when there are no beans', async () => {
    render(() => <BeansSection loadBeans={async () => []} />);
    await waitFor(() => screen.getByText(/No beans yet/i));
  });

  it('shows a connection error when the list fails to load', async () => {
    render(() => (
      <BeansSection
        loadBeans={async () => {
          throw new Error('offline');
        }}
      />
    ));
    await waitFor(() => screen.getByTestId('beans-load-error'));
  });

  it('creates a bean and opens the editor on it', async () => {
    const created = mkBean({ id: 'new-1', roaster: 'Onyx', name: 'Geometry' });
    const createBean = vi.fn(async () => created);
    render(() => (
      <BeansSection
        loadBeans={async () => []}
        createBean={createBean}
        loadBean={async () => created}
        loadShots={async () => ({ items: [], total: 0, limit: 100, offset: 0 })}
      />
    ));
    fireEvent.click(await waitFor(() => screen.getByTestId('open-new-bean')));
    fireEvent.input(screen.getByTestId('new-bean-roaster'), {
      target: { value: 'Onyx' },
    });
    fireEvent.input(screen.getByTestId('new-bean-name'), {
      target: { value: 'Geometry' },
    });
    fireEvent.submit(screen.getByTestId('new-bean-form'));

    await waitFor(() =>
      expect(createBean).toHaveBeenCalledWith({
        roaster: 'Onyx',
        name: 'Geometry',
      }),
    );
    await waitFor(() => screen.getByTestId('bean-editor'));
  });

  it('passes includeArchived through when toggled', async () => {
    const loadBeans = vi.fn(async () => [] as Bean[]);
    render(() => <BeansSection loadBeans={loadBeans} />);
    await waitFor(() => expect(loadBeans).toHaveBeenCalledWith({ includeArchived: false }));
    fireEvent.click(screen.getByTestId('beans-show-archived'));
    await waitFor(() =>
      expect(loadBeans).toHaveBeenCalledWith({ includeArchived: true }),
    );
  });
});
