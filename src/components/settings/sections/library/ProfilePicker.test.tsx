import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { within } from '@solidjs/testing-library';
import { ProfilePicker } from './ProfilePicker';
import type { ProfileRecord } from '../../../../api';

const mkProfile = (over: Partial<ProfileRecord> = {}): ProfileRecord => ({
  id: over.id ?? 'profile:abc123',
  profile: over.profile ?? { title: 'Best Practice C+', author: 'Decent' },
  metadataHash: 'meta-hash',
  compoundHash: 'compound-hash',
  parentId: null,
  visibility: 'visible',
  isDefault: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

const defaultProfile = mkProfile({
  id: 'profile:default-1',
  profile: {
    title: 'Adaptive Decent Default',
    author: 'Decent',
    notes: 'A flexible profile for most beans.',
    beverage_type: 'espresso',
    target_weight: 36,
    tank_temperature: 90,
    steps: [{ name: 'hold', pump: 'pressure', seconds: 10, pressure: 9 }],
  },
  isDefault: true,
});

const userProfile = mkProfile({
  id: 'profile:user-1',
  profile: {
    title: "Wife's Latte",
    author: 'Rotem',
    target_weight: 40,
    steps: [{ name: 'hold', pump: 'pressure', seconds: 10, pressure: 6 }],
  },
  isDefault: false,
});

describe('ProfilePicker', () => {
  describe('load states', () => {
    it('shows a loading message while the fetch is pending', () => {
      render(() => (
        <ProfilePicker loadProfiles={() => new Promise(() => {})} />
      ));
      expect(
        screen.getByTestId('profile-picker-loading'),
      ).toBeInTheDocument();
    });

    it('renders an error status when the fetch rejects', async () => {
      render(() => (
        <ProfilePicker
          loadProfiles={() => Promise.reject(new Error('boom'))}
        />
      ));
      await waitFor(() =>
        expect(
          screen.getByTestId('profile-picker-error'),
        ).toBeInTheDocument(),
      );
    });

    it('renders an empty status when the gateway returns no profiles', async () => {
      render(() => <ProfilePicker loadProfiles={() => Promise.resolve([])} />);
      await waitFor(() =>
        expect(
          screen.getByTestId('profile-picker-empty'),
        ).toBeInTheDocument(),
      );
    });
  });

  describe('list', () => {
    it('lists profiles sorted alphabetically by title', async () => {
      render(() => (
        <ProfilePicker
          loadProfiles={() =>
            Promise.resolve([
              mkProfile({ id: 'p-b', profile: { title: 'Bravo' } }),
              mkProfile({ id: 'p-a', profile: { title: 'Alpha' } }),
              mkProfile({ id: 'p-c', profile: { title: 'Charlie' } }),
            ])
          }
        />
      ));
      const list = await waitFor(() =>
        screen.getByTestId('profile-picker-list'),
      );
      // Scope to the list itself (the detail pane has its own rendering
      // of the previewed title, which would otherwise pollute textContent).
      const rows = within(list).getAllByRole('option');
      const titles = rows.map((r) => r.textContent ?? '');
      expect(titles[0]).toContain('Alpha');
      expect(titles[1]).toContain('Bravo');
      expect(titles[2]).toContain('Charlie');
    });

    it('falls back to (untitled) when a profile has no title', async () => {
      render(() => (
        <ProfilePicker
          loadProfiles={() => Promise.resolve([mkProfile({ profile: {} })])}
        />
      ));
      const list = await waitFor(() =>
        screen.getByTestId('profile-picker-list'),
      );
      expect(within(list).getByText('(untitled)')).toBeInTheDocument();
    });

    it('shows the default badge for bundled defaults but not for user profiles', async () => {
      render(() => (
        <ProfilePicker
          loadProfiles={() => Promise.resolve([defaultProfile, userProfile])}
        />
      ));
      await waitFor(() => screen.getByTestId('profile-picker-list'));
      expect(
        screen.getByTestId(
          `profile-row-${defaultProfile.id}-default-badge`,
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId(
          `profile-row-${userProfile.id}-default-badge`,
        ),
      ).not.toBeInTheDocument();
    });

    it('shows author below the title when present', async () => {
      render(() => (
        <ProfilePicker
          loadProfiles={() => Promise.resolve([defaultProfile])}
        />
      ));
      await waitFor(() => screen.getByTestId('profile-picker-list'));
      const row = screen.getByTestId(`profile-row-${defaultProfile.id}`);
      expect(row).toHaveTextContent('Decent');
    });
  });

  describe('preview pane (always rendered when there are profiles)', () => {
    it('seeds the preview from the first profile when no selectedId is set', async () => {
      render(() => (
        <ProfilePicker
          loadProfiles={() =>
            Promise.resolve([defaultProfile, userProfile])
          }
        />
      ));
      await waitFor(() => screen.getByTestId('profile-picker-split'));
      // First alphabetically is "Adaptive Decent Default".
      const preview = screen.getByTestId('profile-preview');
      expect(preview).toHaveTextContent('Adaptive Decent Default');
    });

    it('seeds the preview from selectedId when provided', async () => {
      render(() => (
        <ProfilePicker
          loadProfiles={() =>
            Promise.resolve([defaultProfile, userProfile])
          }
          selectedId={userProfile.id}
        />
      ));
      await waitFor(() => screen.getByTestId('profile-picker-split'));
      expect(screen.getByTestId('profile-preview')).toHaveTextContent(
        "Wife's Latte",
      );
    });

    it('tapping a row updates the preview pane to that profile', async () => {
      render(() => (
        <ProfilePicker
          loadProfiles={() =>
            Promise.resolve([defaultProfile, userProfile])
          }
        />
      ));
      await waitFor(() => screen.getByTestId('profile-picker-split'));
      fireEvent.click(
        screen.getByTestId(`profile-row-${userProfile.id}-button`),
      );
      const preview = screen.getByTestId('profile-preview');
      expect(preview).toHaveTextContent("Wife's Latte");
    });
  });

  describe('row state semantics', () => {
    it('the previewed row carries data-previewed and aria-selected="true"', async () => {
      render(() => (
        <ProfilePicker
          loadProfiles={() =>
            Promise.resolve([defaultProfile, userProfile])
          }
          selectedId={userProfile.id}
        />
      ));
      await waitFor(() => screen.getByTestId('profile-picker-list'));
      const row = screen.getByTestId(`profile-row-${userProfile.id}`);
      expect(row).toHaveAttribute('data-previewed', 'true');
      expect(row).toHaveAttribute('aria-selected', 'true');
    });

    it('the pinned (selectedId) row shows the ✓ check, even when not currently previewed', async () => {
      render(() => (
        <ProfilePicker
          loadProfiles={() =>
            Promise.resolve([defaultProfile, userProfile])
          }
          selectedId={userProfile.id}
        />
      ));
      await waitFor(() => screen.getByTestId('profile-picker-list'));
      // Pinned row has the ✓ regardless of previewed state.
      expect(
        screen.getByTestId(`profile-row-${userProfile.id}-selected`),
      ).toBeInTheDocument();
      // Switch preview to the other row; ✓ stays on userProfile.
      fireEvent.click(
        screen.getByTestId(`profile-row-${defaultProfile.id}-button`),
      );
      expect(
        screen.getByTestId(`profile-row-${userProfile.id}-selected`),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId(`profile-row-${defaultProfile.id}-selected`),
      ).not.toBeInTheDocument();
    });
  });

  describe('browse mode (no onSelect)', () => {
    it('renders no footer', async () => {
      render(() => (
        <ProfilePicker
          loadProfiles={() => Promise.resolve([defaultProfile])}
        />
      ));
      await waitFor(() => screen.getByTestId('profile-picker-list'));
      expect(
        screen.queryByTestId('profile-picker-footer'),
      ).not.toBeInTheDocument();
    });
  });

  describe('select mode (onSelect provided)', () => {
    it('renders Cancel and Choose buttons in the footer', async () => {
      render(() => (
        <ProfilePicker
          loadProfiles={() => Promise.resolve([defaultProfile])}
          onSelect={() => {}}
          onCancel={() => {}}
        />
      ));
      await waitFor(() => screen.getByTestId('profile-picker-list'));
      expect(
        screen.getByTestId('profile-picker-footer'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('profile-picker-cancel'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('profile-picker-choose'),
      ).toBeInTheDocument();
    });

    it('row click does NOT call onSelect — only updates the preview', async () => {
      const onSelect = vi.fn();
      render(() => (
        <ProfilePicker
          loadProfiles={() =>
            Promise.resolve([defaultProfile, userProfile])
          }
          onSelect={onSelect}
        />
      ));
      await waitFor(() => screen.getByTestId('profile-picker-list'));
      fireEvent.click(
        screen.getByTestId(`profile-row-${userProfile.id}-button`),
      );
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('Choose commits the previewed id via onSelect', async () => {
      const onSelect = vi.fn();
      render(() => (
        <ProfilePicker
          loadProfiles={() =>
            Promise.resolve([defaultProfile, userProfile])
          }
          onSelect={onSelect}
        />
      ));
      await waitFor(() => screen.getByTestId('profile-picker-list'));
      fireEvent.click(
        screen.getByTestId(`profile-row-${userProfile.id}-button`),
      );
      fireEvent.click(screen.getByTestId('profile-picker-choose'));
      expect(onSelect).toHaveBeenCalledWith(userProfile.id);
    });

    it('Cancel calls onCancel and does not call onSelect', async () => {
      const onSelect = vi.fn();
      const onCancel = vi.fn();
      render(() => (
        <ProfilePicker
          loadProfiles={() => Promise.resolve([defaultProfile])}
          onSelect={onSelect}
          onCancel={onCancel}
        />
      ));
      await waitFor(() => screen.getByTestId('profile-picker-list'));
      fireEvent.click(screen.getByTestId('profile-picker-cancel'));
      expect(onCancel).toHaveBeenCalledOnce();
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('Choose without any selectedId still commits the auto-previewed first profile', async () => {
      // When no selectedId is passed, the picker auto-previews the first
      // profile so Choose has something to commit. This is the common
      // "Recipe has no profile pinned yet, user opens the picker" case.
      const onSelect = vi.fn();
      render(() => (
        <ProfilePicker
          loadProfiles={() =>
            Promise.resolve([userProfile, defaultProfile])
          }
          onSelect={onSelect}
        />
      ));
      await waitFor(() => screen.getByTestId('profile-picker-split'));
      // Choose without tapping any row — should pick first alphabetically.
      fireEvent.click(screen.getByTestId('profile-picker-choose'));
      // "Adaptive Decent Default" sorts before "Wife's Latte".
      expect(onSelect).toHaveBeenCalledWith(defaultProfile.id);
    });
  });
});
