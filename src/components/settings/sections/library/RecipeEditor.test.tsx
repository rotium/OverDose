import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { RecipeEditor } from './RecipeEditor';
import { WithRepositories } from '../../../../test/repositories';
import {
  LocalRoutineRepository,
  LocalRecipeRepository,
} from '../../../../repositories';
import { MemoryStorage } from '../../../../test/memoryStorage';
import { routineStep } from '../../../../domain';
import type { Routine, Recipe } from '../../../../domain';
import type { Bean, ProfileRecord } from '../../../../api';

interface SeedOpts {
  routines?: Routine[];
  recipes?: Recipe[];
  /** Profile-list fetcher seam (default: no profiles). */
  loadProfiles?: () => Promise<ProfileRecord[]>;
  /** Single-profile fetcher seam (default: null for any id). */
  loadProfileById?: (id: string) => Promise<ProfileRecord | null>;
  /** Bean-list fetcher seam for the picker (default: no beans). */
  loadBeans?: () => Promise<Bean[]>;
  /** Single-bean fetcher seam (default: null for any id). */
  loadBeanById?: (id: string) => Promise<Bean | null>;
}

const mkBean = (over: Partial<Bean> = {}): Bean => ({
  id: over.id ?? 'bean-1',
  roaster: over.roaster ?? 'Square Mile',
  name: over.name ?? 'Red Brick',
  decaf: false,
  archived: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

const mkProfileRecord = (
  over: Partial<ProfileRecord> = {},
): ProfileRecord => ({
  id: over.id ?? 'profile:abc',
  profile: over.profile ?? { title: 'Best Practice C+', author: 'Decent' },
  metadataHash: 'meta',
  compoundHash: 'compound',
  parentId: null,
  visibility: 'visible',
  isDefault: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

const seedRepos = ({ routines = [], recipes = [] }: SeedOpts) => {
  const bStore = new MemoryStorage();
  bStore.setItem('starter-skin.routines.v1', JSON.stringify(routines));
  bStore.setItem('starter-skin.routines.seeded.v1', '1');
  const rStore = new MemoryStorage();
  rStore.setItem('starter-skin.recipes.v1', JSON.stringify(recipes));
  rStore.setItem('starter-skin.recipes.seeded.v1', '1');
  return {
    routines: new LocalRoutineRepository(bStore),
    recipes: new LocalRecipeRepository(rStore),
  };
};

const cappuccinoBev = (id = 'bev-cap'): Routine => ({
  id,
  name: 'Cappuccino',
  steps: [routineStep('brew', {}), routineStep('steam', {})],
});

const espressoBev = (id = 'bev-esp'): Routine => ({
  id,
  name: 'Espresso',
  steps: [routineStep('brew', {})],
});

const sampleRecipe = (over: Partial<Recipe> = {}): Recipe => ({
  id: 'rec-1',
  name: "Wife's",
  routineId: 'bev-cap',
  overrides: {},
  doseGrams: 18,
  grinderSetting: 4.5,
  ...over,
});

const renderEditor = (opts: SeedOpts, recipeId = 'rec-1') => {
  const repos = seedRepos(opts);
  const onClose = vi.fn();
  // Default profile fetchers return "no profiles" / null so RecipeEditor
  // never hits the real api in tests. Callers that exercise the picker
  // override these.
  const loadProfiles =
    opts.loadProfiles ?? (() => Promise.resolve<ProfileRecord[]>([]));
  const loadProfileById =
    opts.loadProfileById ?? (() => Promise.resolve<ProfileRecord | null>(null));
  const loadBeans = opts.loadBeans ?? (() => Promise.resolve<Bean[]>([]));
  const loadBeanById =
    opts.loadBeanById ?? (() => Promise.resolve<Bean | null>(null));
  render(() => (
    <WithRepositories routines={repos.routines} recipes={repos.recipes}>
        <RecipeEditor
          recipeId={recipeId}
          onClose={onClose}
          debounceMs={0}
          loadProfiles={loadProfiles}
          loadProfileById={loadProfileById}
          loadBeans={loadBeans}
          loadBeanById={loadBeanById}
        />
    </WithRepositories>
  ));
  return { repos, onClose };
};

describe('RecipeEditor', () => {
  describe('loading + not-found', () => {
    it('renders not-found when the id does not exist', async () => {
      renderEditor({ recipes: [] }, 'missing');
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(/not found/i),
      );
    });
  });

  describe('name editing', () => {
    it('persists a renamed recipe on change', async () => {
      const { repos } = renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      const input = (await waitFor(() =>
        screen.getByTestId('recipe-name-input'),
      )) as HTMLInputElement;
      input.value = 'Indonesia X';
      fireEvent.change(input);
      await waitFor(async () => {
        const r = await repos.recipes.get('rec-1');
        expect(r?.name).toBe('Indonesia X');
      });
    });

    it('ignores whitespace-only names', async () => {
      const { repos } = renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      const input = (await waitFor(() =>
        screen.getByTestId('recipe-name-input'),
      )) as HTMLInputElement;
      input.value = '  ';
      fireEvent.change(input);
      expect((await repos.recipes.get('rec-1'))?.name).toBe("Wife's");
    });
  });

  describe('routine re-target', () => {
    it('lists all visible routines and seeds the current selection', async () => {
      renderEditor({
        routines: [cappuccinoBev(), espressoBev()],
        recipes: [sampleRecipe()],
      });
      const select = (await waitFor(() =>
        screen.getByTestId('recipe-routine-select'),
      )) as HTMLSelectElement;
      expect(select.value).toBe('bev-cap');
      expect(select.options).toHaveLength(2);
    });

    it('changing the routine persists the new routineId', async () => {
      const { repos } = renderEditor({
        routines: [cappuccinoBev(), espressoBev()],
        recipes: [sampleRecipe()],
      });
      const select = (await waitFor(() =>
        screen.getByTestId('recipe-routine-select'),
      )) as HTMLSelectElement;
      select.value = 'bev-esp';
      fireEvent.change(select);
      await waitFor(async () => {
        const r = await repos.recipes.get('rec-1');
        expect(r?.routineId).toBe('bev-esp');
      });
    });

    it('keeps a missing parent routine selectable so the editor opens cleanly', async () => {
      renderEditor({
        routines: [],
        recipes: [sampleRecipe({ routineId: 'gone' })],
      });
      const select = (await waitFor(() =>
        screen.getByTestId('recipe-routine-select'),
      )) as HTMLSelectElement;
      expect(select.value).toBe('gone');
      expect(select).toHaveTextContent(/missing routine/i);
    });

    it('renders the parent Routine step-sequence hint below the select', async () => {
      renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      const seq = await waitFor(() =>
        screen.getByTestId('recipe-routine-sequence'),
      );
      // cappuccinoBev() seeds [brew, steam].
      expect(seq).toHaveTextContent('Brew → Steam');
    });

    it('sequence hint updates when the user re-targets the Routine', async () => {
      renderEditor({
        routines: [
          cappuccinoBev(),
          { id: 'bev-flush-only', name: 'Flush-only', steps: [routineStep('flush', {})] },
        ],
        recipes: [sampleRecipe()],
      });
      const select = (await waitFor(() =>
        screen.getByTestId('recipe-routine-select'),
      )) as HTMLSelectElement;
      select.value = 'bev-flush-only';
      fireEvent.change(select);
      await waitFor(() =>
        expect(screen.getByTestId('recipe-routine-sequence')).toHaveTextContent(
          /^Flush$/,
        ),
      );
    });

    it('falls back to "(no steps yet)" when the parent has no steps', async () => {
      renderEditor({
        routines: [{ id: 'bev-empty', name: 'Blank', steps: [] }],
        recipes: [sampleRecipe({ routineId: 'bev-empty' })],
      });
      await waitFor(() =>
        expect(screen.getByTestId('recipe-routine-sequence')).toHaveTextContent(
          /no steps yet/i,
        ),
      );
    });
  });

  describe('brewing fields', () => {
    it('seeds dose + grinder setting from storage', async () => {
      renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      const dose = (await waitFor(() =>
        screen.getByTestId('recipe-dose-input'),
      )) as HTMLInputElement;
      const grinder = screen.getByTestId(
        'recipe-grinder-setting-input',
      ) as HTMLInputElement;
      expect(dose.value).toBe('18');
      expect(grinder.value).toBe('4.5');
    });

    it('edits dose and persists', async () => {
      const { repos } = renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      const dose = (await waitFor(() =>
        screen.getByTestId('recipe-dose-input'),
      )) as HTMLInputElement;
      dose.value = '19.5';
      fireEvent.input(dose);
      await waitFor(async () => {
        const r = await repos.recipes.get('rec-1');
        expect(r?.doseGrams).toBe(19.5);
      });
    });

    it('clearing dose stores undefined', async () => {
      const { repos } = renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      const dose = (await waitFor(() =>
        screen.getByTestId('recipe-dose-input'),
      )) as HTMLInputElement;
      dose.value = '';
      fireEvent.input(dose);
      await waitFor(async () => {
        const r = await repos.recipes.get('rec-1');
        expect(r?.doseGrams).toBeUndefined();
      });
    });

    it('edits grinder setting and persists', async () => {
      const { repos } = renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      const g = (await waitFor(() =>
        screen.getByTestId('recipe-grinder-setting-input'),
      )) as HTMLInputElement;
      g.value = '5';
      fireEvent.input(g);
      await waitFor(async () => {
        const r = await repos.recipes.get('rec-1');
        expect(r?.grinderSetting).toBe(5);
      });
    });

    it('edits target yield and persists', async () => {
      const { repos } = renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      const y = (await waitFor(() =>
        screen.getByTestId('recipe-target-yield-input'),
      )) as HTMLInputElement;
      y.value = '36';
      fireEvent.input(y);
      await waitFor(async () => {
        const r = await repos.recipes.get('rec-1');
        expect(r?.targetYieldGrams).toBe(36);
      });
    });

    it('edits target volume and persists', async () => {
      const { repos } = renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      const v = (await waitFor(() =>
        screen.getByTestId('recipe-target-volume-input'),
      )) as HTMLInputElement;
      v.value = '40';
      fireEvent.input(v);
      await waitFor(async () => {
        const r = await repos.recipes.get('rec-1');
        expect(r?.targetVolumeMl).toBe(40);
      });
    });

    it('clearing target yield stores undefined', async () => {
      const { repos } = renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe({ targetYieldGrams: 36 })],
      });
      const y = (await waitFor(() =>
        screen.getByTestId('recipe-target-yield-input'),
      )) as HTMLInputElement;
      y.value = '';
      fireEvent.input(y);
      await waitFor(async () => {
        const r = await repos.recipes.get('rec-1');
        expect(r?.targetYieldGrams).toBeUndefined();
      });
    });
  });

  describe('profile picker', () => {
    it('shows "No profile selected" copy when the Recipe has no profileId', async () => {
      renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe({ profileId: undefined })],
      });
      const field = await waitFor(() =>
        screen.getByTestId('recipe-editor-profile-field'),
      );
      expect(field).toHaveTextContent(/no profile selected/i);
      // No clear button when nothing is pinned.
      expect(
        screen.queryByTestId('recipe-profile-clear'),
      ).not.toBeInTheDocument();
    });

    it('renders the selected profile title once the by-id fetch resolves', async () => {
      const profile = mkProfileRecord({
        id: 'profile:cool',
        profile: { title: 'Cool Profile' },
      });
      renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe({ profileId: profile.id })],
        loadProfileById: () => Promise.resolve(profile),
      });
      await waitFor(() =>
        expect(screen.getByTestId('recipe-profile-open')).toHaveTextContent(
          'Cool Profile',
        ),
      );
    });

    it('falls back to "(missing profile — id)" when the by-id fetch returns null', async () => {
      // Mirrors what the gateway does when a profile id no longer
      // resolves (deleted, hidden, or offline): the loader resolves to
      // null and we render a graceful fallback instead of the title.
      renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe({ profileId: 'profile:ghost' })],
        loadProfileById: () => Promise.resolve(null),
      });
      await waitFor(() =>
        expect(screen.getByTestId('recipe-profile-open')).toHaveTextContent(
          'missing profile — profile:ghost',
        ),
      );
    });

    it('opens the picker dialog when the field button is clicked', async () => {
      renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe({ profileId: undefined })],
      });
      await waitFor(() => screen.getByTestId('recipe-profile-open'));
      // Dialog is not mounted before the open.
      expect(
        screen.queryByTestId('recipe-profile-dialog'),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('recipe-profile-open'));
      await waitFor(() =>
        expect(
          screen.getByTestId('recipe-profile-dialog'),
        ).toBeInTheDocument(),
      );
    });

    it('selecting a profile in the dialog persists the id and closes the dialog', async () => {
      // Two-step commit: tap the row to preview it, then press Choose to
      // commit. Tap-to-commit was the v1 behaviour and made browsing
      // impossible — now the dialog is a real picker with a deliberate
      // Choose action.
      const profile = mkProfileRecord({
        id: 'profile:newly-picked',
        profile: { title: 'Newly Picked' },
      });
      const { repos } = renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe({ profileId: undefined })],
        loadProfiles: () => Promise.resolve([profile]),
      });
      await waitFor(() => screen.getByTestId('recipe-profile-open'));
      fireEvent.click(screen.getByTestId('recipe-profile-open'));
      const row = await waitFor(() =>
        screen.getByTestId(`profile-row-${profile.id}-button`),
      );
      fireEvent.click(row);
      // Row click alone doesn't commit — Choose does.
      fireEvent.click(screen.getByTestId('profile-picker-choose'));

      await waitFor(async () => {
        const r = await repos.recipes.get('rec-1');
        expect(r?.profileId).toBe(profile.id);
      });
      // Dialog gone after Choose.
      await waitFor(() =>
        expect(
          screen.queryByTestId('recipe-profile-dialog'),
        ).not.toBeInTheDocument(),
      );
    });

    it('Cancel in the dialog closes it without changing the Recipe', async () => {
      const profile = mkProfileRecord({
        id: 'profile:other',
        profile: { title: 'Other' },
      });
      const { repos } = renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe({ profileId: undefined })],
        loadProfiles: () => Promise.resolve([profile]),
      });
      await waitFor(() => screen.getByTestId('recipe-profile-open'));
      fireEvent.click(screen.getByTestId('recipe-profile-open'));
      const row = await waitFor(() =>
        screen.getByTestId(`profile-row-${profile.id}-button`),
      );
      fireEvent.click(row);
      fireEvent.click(screen.getByTestId('profile-picker-cancel'));

      await waitFor(() =>
        expect(
          screen.queryByTestId('recipe-profile-dialog'),
        ).not.toBeInTheDocument(),
      );
      const r = await repos.recipes.get('rec-1');
      expect(r?.profileId).toBeUndefined();
    });

    it('clear button removes the profile from the Recipe', async () => {
      const profile = mkProfileRecord({
        id: 'profile:to-clear',
        profile: { title: 'To Clear' },
      });
      const { repos } = renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe({ profileId: profile.id })],
        loadProfileById: () => Promise.resolve(profile),
      });
      const clear = await waitFor(() =>
        screen.getByTestId('recipe-profile-clear'),
      );
      fireEvent.click(clear);
      await waitFor(async () => {
        const r = await repos.recipes.get('rec-1');
        expect(r?.profileId).toBeUndefined();
      });
    });
  });

  describe('coming-soon stubs', () => {
    it('renders a disabled placeholder for Grinder only', async () => {
      // Espresso profile (2026-05-26) and Bean (2026-06-02) graduated out of
      // "Coming soon" into real picker rows. Grinder is the last stub.
      renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      const heading = await waitFor(() => screen.getByText('Coming soon'));
      const section = heading.parentElement!;
      expect(section).toHaveTextContent('Grinder');
      expect(section).not.toHaveTextContent('Espresso profile');
      expect(section.textContent?.match(/library not built/gi) ?? []).toHaveLength(1);
    });
  });

  describe('bean picker', () => {
    it('shows the empty state when no bean is selected', async () => {
      renderEditor({ routines: [cappuccinoBev()], recipes: [sampleRecipe()] });
      const row = await waitFor(() =>
        screen.getByTestId('recipe-editor-bean-field'),
      );
      expect(row).toHaveTextContent(/No bean selected/i);
    });

    it('picks a bean and stores its id on the recipe', async () => {
      const bean = mkBean({ id: 'bean-1', roaster: 'Onyx', name: 'Geometry' });
      const { repos } = renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe()],
        loadBeans: () => Promise.resolve([bean]),
        loadBeanById: () => Promise.resolve(bean),
      });
      fireEvent.click(await waitFor(() => screen.getByTestId('recipe-bean-open')));
      fireEvent.click(await waitFor(() => screen.getByTestId('bean-pick-bean-1')));
      await waitFor(async () => {
        expect((await repos.recipes.get('rec-1'))?.beanId).toBe('bean-1');
      });
      await waitFor(() =>
        expect(screen.getByTestId('recipe-editor-bean-field')).toHaveTextContent(
          'Onyx — Geometry',
        ),
      );
    });

    it('clears the selected bean', async () => {
      const bean = mkBean({ id: 'bean-1' });
      const { repos } = renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe({ beanId: 'bean-1' })],
        loadBeanById: () => Promise.resolve(bean),
      });
      fireEvent.click(
        await waitFor(() => screen.getByTestId('recipe-bean-clear')),
      );
      await waitFor(async () => {
        expect((await repos.recipes.get('rec-1'))?.beanId).toBeUndefined();
      });
    });

    it('shows an archived tag for a bean that has since been archived', async () => {
      const bean = mkBean({ id: 'bean-1', archived: true });
      renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe({ beanId: 'bean-1' })],
        loadBeanById: () => Promise.resolve(bean),
      });
      const row = await waitFor(() =>
        screen.getByTestId('recipe-editor-bean-field'),
      );
      await waitFor(() => expect(row).toHaveTextContent(/archived/i));
    });

    it('falls back to a missing hint when the bean no longer resolves', async () => {
      renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe({ beanId: 'gone' })],
        loadBeanById: () => Promise.resolve(null),
      });
      const row = await waitFor(() =>
        screen.getByTestId('recipe-editor-bean-field'),
      );
      await waitFor(() => expect(row).toHaveTextContent(/missing bean/i));
    });
  });

  describe('delete', () => {
    it('confirms then deletes and closes the editor', async () => {
      const { repos, onClose } = renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      await waitFor(() => screen.getByTestId('delete-recipe-button'));
      fireEvent.click(screen.getByTestId('delete-recipe-button'));
      expect(screen.getByTestId('delete-confirm')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('confirm-delete-recipe-button'));
      await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
      expect(await repos.recipes.get('rec-1')).toBeNull();
    });

    it('cancel keeps the recipe', async () => {
      const { repos, onClose } = renderEditor({
        routines: [cappuccinoBev()],
        recipes: [sampleRecipe()],
      });
      await waitFor(() => screen.getByTestId('delete-recipe-button'));
      fireEvent.click(screen.getByTestId('delete-recipe-button'));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByTestId('delete-confirm')).not.toBeInTheDocument();
      expect(await repos.recipes.get('rec-1')).not.toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});

describe('RecipeEditor — pitcher picker', () => {
  it('hides the pitcher picker when the routine has no steam step', async () => {
    renderEditor({
      routines: [espressoBev()],
      recipes: [sampleRecipe({ routineId: 'bev-esp' })],
    });
    await waitFor(() => screen.getByTestId('recipe-editor'));
    expect(
      screen.queryByTestId('recipe-pitcher-section'),
    ).not.toBeInTheDocument();
  });

  it('shows the picker for a steaming routine and persists the choice', async () => {
    const { repos } = renderEditor({
      routines: [cappuccinoBev()],
      recipes: [sampleRecipe()],
    });
    const select = (await waitFor(() =>
      screen.getByTestId('recipe-pitcher-select'),
    )) as HTMLSelectElement;
    // Seeded pitchers are available as options.
    select.value = 'seed-pitcher-large';
    fireEvent.change(select);
    await waitFor(async () => {
      expect((await repos.recipes.get('rec-1'))?.pitcherId).toBe(
        'seed-pitcher-large',
      );
    });
  });

  it('clearing the pitcher stores undefined', async () => {
    const { repos } = renderEditor({
      routines: [cappuccinoBev()],
      recipes: [sampleRecipe({ pitcherId: 'seed-pitcher-large' })],
    });
    const select = (await waitFor(() =>
      screen.getByTestId('recipe-pitcher-select'),
    )) as HTMLSelectElement;
    select.value = '';
    fireEvent.change(select);
    await waitFor(async () => {
      expect((await repos.recipes.get('rec-1'))?.pitcherId).toBeUndefined();
    });
  });
});
