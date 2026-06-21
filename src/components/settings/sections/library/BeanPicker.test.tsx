import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { BeanPicker } from './BeanPicker';
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

describe('BeanPicker', () => {
  it('groups beans by roaster (roasters sorted, names nested and sorted)', async () => {
    const beans = [
      mkBean({ id: 'b1', roaster: 'Square Mile', name: 'Sweetshop' }),
      mkBean({ id: 'b2', roaster: 'Square Mile', name: 'Red Brick' }),
      mkBean({ id: 'b3', roaster: 'Onyx', name: 'Geometry' }),
    ];
    render(() => (
      <BeanPicker onSelect={vi.fn()} onCancel={vi.fn()} loadBeans={async () => beans} />
    ));
    await waitFor(() => screen.getByTestId('bean-picker-list'));
    const list = screen.getByTestId('bean-picker-list');
    // Roaster group headers, in sorted order.
    const roasters = [...list.querySelectorAll('.bean-tree__roaster')].map((r) =>
      r.textContent?.trim(),
    );
    expect(roasters).toEqual(['Onyx', 'Square Mile']);
    // Bean names, nested under their roaster, sorted within each group.
    const names = [...list.querySelectorAll('.library-list__name')].map((r) =>
      r.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(names).toEqual(['Geometry', 'Red Brick', 'Sweetshop']);
  });

  it('search filters by roaster or bean name', async () => {
    const beans = [
      mkBean({ id: 'b1', roaster: 'Square Mile', name: 'Sweetshop' }),
      mkBean({ id: 'b2', roaster: 'Onyx', name: 'Geometry' }),
    ];
    render(() => (
      <BeanPicker onSelect={vi.fn()} onCancel={vi.fn()} loadBeans={async () => beans} />
    ));
    const input = await waitFor(() => screen.getByTestId('bean-picker-search'));
    fireEvent.input(input, { target: { value: 'onyx' } });
    await waitFor(() => screen.getByTestId('bean-pick-b2'));
    expect(screen.queryByTestId('bean-pick-b1')).toBeNull();
    // A query that matches nothing shows the no-match state.
    fireEvent.input(input, { target: { value: 'zzz' } });
    await waitFor(() => screen.getByText(/No beans match/i));
  });

  it('selecting a row calls onSelect with the bean id', async () => {
    const onSelect = vi.fn();
    render(() => (
      <BeanPicker
        onSelect={onSelect}
        onCancel={vi.fn()}
        loadBeans={async () => [mkBean({ id: 'b1' })]}
      />
    ));
    fireEvent.click(await waitFor(() => screen.getByTestId('bean-pick-b1')));
    expect(onSelect).toHaveBeenCalledWith('b1');
  });

  it('shows the empty state when there are no beans', async () => {
    render(() => (
      <BeanPicker onSelect={vi.fn()} onCancel={vi.fn()} loadBeans={async () => []} />
    ));
    await waitFor(() => screen.getByText(/No beans yet/i));
  });

  it('shows a connection error when the load fails', async () => {
    render(() => (
      <BeanPicker
        onSelect={vi.fn()}
        onCancel={vi.fn()}
        loadBeans={async () => {
          throw new Error('offline');
        }}
      />
    ));
    await waitFor(() => screen.getByRole('alert'));
  });
});
