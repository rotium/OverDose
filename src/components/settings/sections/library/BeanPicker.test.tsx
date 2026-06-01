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
  it('lists beans alphabetically by name', async () => {
    const beans = [
      mkBean({ id: 'b1', roaster: 'Square Mile', name: 'Sweetshop' }),
      mkBean({ id: 'b2', roaster: 'Has Bean', name: 'Jailbreak' }),
      mkBean({ id: 'b3', roaster: 'Onyx', name: 'Geometry' }),
    ];
    render(() => (
      <BeanPicker onSelect={vi.fn()} onCancel={vi.fn()} loadBeans={async () => beans} />
    ));
    await waitFor(() => screen.getByTestId('bean-picker-list'));
    const rows = screen
      .getByTestId('bean-picker-list')
      .querySelectorAll('.library-list__name');
    expect([...rows].map((r) => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Onyx — Geometry',
      'Has Bean — Jailbreak',
      'Square Mile — Sweetshop',
    ]);
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
