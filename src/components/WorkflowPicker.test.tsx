import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import type { Workflow } from '../domain';
import type { WorkflowRepository } from '../repositories';
import { WorkflowPicker } from './WorkflowPicker';

const wf = (id: string, name = id): Workflow => ({
  id,
  name,
  pipeline: { id: `p-${id}`, name, steps: [] },
});

const repo = (workflows: Workflow[] | (() => Promise<Workflow[]>)): WorkflowRepository => ({
  list: typeof workflows === 'function' ? workflows : () => Promise.resolve(workflows),
  get: async () => null,
  create: async (w) => w,
  update: async (w) => w,
  delete: async () => {},
});

describe('WorkflowPicker', () => {
  it('renders one tile per workflow', async () => {
    render(() => (
      <WorkflowPicker
        repository={repo([wf('a', 'Espresso'), wf('b', 'Cappuccino')])}
        onSelect={() => {}}
      />
    ));
    await waitFor(() => {
      expect(screen.getByTestId('workflow-tile-a')).toBeInTheDocument();
      expect(screen.getByTestId('workflow-tile-b')).toBeInTheDocument();
    });
    expect(screen.getByText('Espresso')).toBeInTheDocument();
    expect(screen.getByText('Cappuccino')).toBeInTheDocument();
  });

  it('invokes onSelect with the chosen workflow on tap', async () => {
    const onSelect = vi.fn();
    const a = wf('a', 'Espresso');
    render(() => <WorkflowPicker repository={repo([a])} onSelect={onSelect} />);
    await waitFor(() => screen.getByTestId('workflow-tile-a'));
    fireEvent.click(screen.getByTestId('workflow-tile-a'));
    expect(onSelect).toHaveBeenCalledWith(a);
  });

  it('renders an empty-state message when there are no workflows', async () => {
    render(() => <WorkflowPicker repository={repo([])} onSelect={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/no workflows yet/i)).toBeInTheDocument();
    });
  });

  it('renders an error state when the repository rejects', async () => {
    render(() => (
      <WorkflowPicker
        repository={repo(() => Promise.reject(new Error('boom')))}
        onSelect={() => {}}
      />
    ));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/failed to load/i);
    });
  });

  it('refreshes the list via the imperative handle', async () => {
    let current: Workflow[] = [wf('a', 'A')];
    const r: WorkflowRepository = {
      list: async () => current,
      get: async () => null,
      create: async (w) => w,
      update: async (w) => w,
      delete: async () => {},
    };
    let handle: { refresh: () => void } | undefined;
    render(() => (
      <WorkflowPicker
        repository={r}
        onSelect={() => {}}
        ref={(h) => (handle = h)}
      />
    ));
    await waitFor(() => screen.getByTestId('workflow-tile-a'));

    current = [wf('a', 'A'), wf('b', 'B')];
    handle!.refresh();
    await waitFor(() => {
      expect(screen.getByTestId('workflow-tile-b')).toBeInTheDocument();
    });
  });
});
