import { Match, Switch, createSignal, type Component } from 'solid-js';
import { BeveragesSection } from './sections/library/BeveragesSection';
import { RecipesSection } from './sections/library/RecipesSection';
import { BeansSection } from './sections/library/BeansSection';
import { ProfilesSection } from './sections/library/ProfilesSection';
import { EquipmentSection } from './sections/library/EquipmentSection';

/**
 * Library tab — user-data CRUD (Beverages, Recipes, Beans, Profiles,
 * Equipment). Same left-side sub-nav pattern as the App tab; each section
 * owns its own list/editor surface. Subsections read from
 * RepositoriesContext rather than receiving repos as props, so the sub-nav
 * doesn't have to thread them through.
 */
type SectionId = 'beverages' | 'recipes' | 'beans' | 'profiles' | 'equipment';

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'beverages', label: 'Beverages' },
  { id: 'recipes', label: 'Recipes' },
  { id: 'beans', label: 'Beans' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'equipment', label: 'Equipment' },
];

export const LibraryTab: Component = () => {
  const [section, setSection] = createSignal<SectionId>('beverages');

  return (
    <div class="settings-subnav">
      <nav
        class="settings-subnav__nav"
        role="tablist"
        aria-label="Library sections"
      >
        {SECTIONS.map((s) => (
          <button
            type="button"
            role="tab"
            class="settings-subnav__tab"
            aria-selected={section() === s.id}
            data-active={section() === s.id}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div class="settings-subnav__content" role="tabpanel">
        <Switch>
          <Match when={section() === 'beverages'}>
            <BeveragesSection />
          </Match>
          <Match when={section() === 'recipes'}>
            <RecipesSection />
          </Match>
          <Match when={section() === 'beans'}>
            <BeansSection />
          </Match>
          <Match when={section() === 'profiles'}>
            <ProfilesSection />
          </Match>
          <Match when={section() === 'equipment'}>
            <EquipmentSection />
          </Match>
        </Switch>
      </div>
    </div>
  );
};
