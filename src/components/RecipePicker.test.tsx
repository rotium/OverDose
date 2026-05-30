import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import type { Recipe } from '../domain';
import type { RecipeRepository } from '../repositories';
import { RecipePicker } from './RecipePicker';
import type { ProfileRecord } from '../api';

const profRec = (
  id: string,
  title: string,
  over: Partial<ProfileRecord> = {},
): ProfileRecord => ({
  id,
  profile: { title },
  metadataHash: 'm',
  compoundHash: 'c',
  parentId: null,
  visibility: 'visible',
  isDefault: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

const rec = (id: string, name = id): Recipe => ({
  id,
  name,
  routineId: `bev-${id}`,
  overrides: {},
});

const repo = (
  recipes: Recipe[] | (() => Promise<Recipe[]>),
): RecipeRepository => ({
  list: typeof recipes === 'function' ? recipes : () => Promise.resolve(recipes),
  listVisible:
    typeof recipes === 'function' ? recipes : () => Promise.resolve(recipes),
  get: async () => null,
  create: async (r: Recipe) => r,
  update: async (r: Recipe) => r,
  delete: async () => {},
  replaceAll: async () => {},
});

describe('RecipePicker', () => {
  it('renders one tile per recipe', async () => {
    render(() => (
      <RecipePicker
        repository={repo([rec('a', 'Espresso'), rec('b', 'Cappuccino')])}
        onSelect={() => {}}
      />
    ));
    await waitFor(() => {
      expect(screen.getByTestId('recipe-tile-a')).toBeInTheDocument();
      expect(screen.getByTestId('recipe-tile-b')).toBeInTheDocument();
    });
    expect(screen.getByText('Espresso')).toBeInTheDocument();
    expect(screen.getByText('Cappuccino')).toBeInTheDocument();
  });

  it('renders the profile-name subtitle on each tile that has a matching profileId', async () => {
    const a: Recipe = { ...rec('a', 'Espresso'), profileId: 'profile:default' };
    const b: Recipe = { ...rec('b', 'Cappuccino'), profileId: 'profile:gentle' };
    const c: Recipe = rec('c', 'No-profile');
    render(() => (
      <RecipePicker
        repository={repo([a, b, c])}
        onSelect={() => {}}
        loadProfiles={() =>
          Promise.resolve([
            profRec('profile:default', 'Best Practice C+'),
            profRec('profile:gentle', 'Gentle and Sweet'),
          ])
        }
      />
    ));
    await waitFor(() =>
      expect(screen.getByTestId('recipe-tile-a-profile')).toHaveTextContent(
        'Best Practice C+',
      ),
    );
    expect(screen.getByTestId('recipe-tile-b-profile')).toHaveTextContent(
      'Gentle and Sweet',
    );
    expect(
      screen.queryByTestId('recipe-tile-c-profile'),
    ).not.toBeInTheDocument();
  });

  it('omits subtitles when the profile fetch fails (graceful degrade)', async () => {
    const a: Recipe = { ...rec('a', 'Espresso'), profileId: 'profile:default' };
    render(() => (
      <RecipePicker
        repository={repo([a])}
        onSelect={() => {}}
        loadProfiles={() => Promise.reject(new Error('boom'))}
      />
    ));
    await waitFor(() => screen.getByTestId('recipe-tile-a'));
    expect(
      screen.queryByTestId('recipe-tile-a-profile'),
    ).not.toBeInTheDocument();
  });

  it('invokes onSelect with the chosen recipe on tap', async () => {
    const onSelect = vi.fn();
    const a = rec('a', 'Espresso');
    render(() => <RecipePicker repository={repo([a])} onSelect={onSelect} />);
    await waitFor(() => screen.getByTestId('recipe-tile-a'));
    fireEvent.click(screen.getByTestId('recipe-tile-a'));
    expect(onSelect).toHaveBeenCalledWith(a);
  });

  it('renders an empty-state message when there are no recipes', async () => {
    render(() => <RecipePicker repository={repo([])} onSelect={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/no recipes shown/i)).toBeInTheDocument();
    });
  });

  it('renders an error state when the repository rejects', async () => {
    render(() => (
      <RecipePicker
        repository={repo(() => Promise.reject(new Error('boom')))}
        onSelect={() => {}}
      />
    ));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/failed to load/i);
    });
  });

  it('tiles are always navigable — gating happens at the prep-screen Start, not at the picker', async () => {
    // Replaces the previous disabledReason / reason-icon tests; the picker
    // no longer carries any "not ready" state.
    const onSelect = vi.fn();
    render(() => (
      <RecipePicker
        repository={repo([rec('a', 'Espresso'), rec('b', 'Cappuccino')])}
        onSelect={onSelect}
      />
    ));
    await waitFor(() => screen.getByTestId('recipe-tile-a'));
    const tileA = screen.getByTestId('recipe-tile-a') as HTMLButtonElement;
    expect(tileA).not.toBeDisabled();
    fireEvent.click(tileA);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('refreshes the list via the imperative handle', async () => {
    let current: Recipe[] = [rec('a', 'A')];
    const r: RecipeRepository = {
      list: async () => current,
      listVisible: async () => current,
      get: async () => null,
      create: async (x: Recipe) => x,
      update: async (x: Recipe) => x,
      delete: async () => {},
      replaceAll: async () => {},
    };
    let handle: { refresh: () => void } | undefined;
    render(() => (
      <RecipePicker
        repository={r}
        onSelect={() => {}}
        ref={(h) => (handle = h)}
      />
    ));
    await waitFor(() => screen.getByTestId('recipe-tile-a'));

    current = [rec('a', 'A'), rec('b', 'B')];
    handle!.refresh();
    await waitFor(() => {
      expect(screen.getByTestId('recipe-tile-b')).toBeInTheDocument();
    });
  });
});
