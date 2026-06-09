import { Match, Switch, createSignal, type Component } from 'solid-js';
import type { ShotSettingsSnapshot } from '../../snapshot';
import type { WsStream } from '../../streams';
import { RoutinesSection } from './sections/library/RoutinesSection';
import { RecipesSection } from './sections/library/RecipesSection';
import { SteamSection } from './sections/library/SteamSection';
import { BeansSection } from './sections/library/BeansSection';
import { ProfilesSection } from './sections/library/ProfilesSection';
import { EquipmentSection } from './sections/library/EquipmentSection';
import { CleaningsSection } from './sections/library/CleaningsSection';

/**
 * Library tab — user-data CRUD (Routines, Recipes, Steam pitchers, Beans,
 * Profiles, Equipment). Same left-side sub-nav pattern as the App tab; each
 * section owns its own list/editor surface. Subsections read from
 * RepositoriesContext rather than receiving repos as props, so the sub-nav
 * doesn't have to thread them through.
 */
type SectionId =
  | 'routines'
  | 'recipes'
  | 'steam'
  | 'beans'
  | 'profiles'
  | 'equipment'
  | 'cleanings';

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'recipes', label: 'Recipes' },
  { id: 'beans', label: 'Beans' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'steam', label: 'Steam' },
  { id: 'cleanings', label: 'Cleanings' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'routines', label: 'Routines' },
];

export interface LibraryTabProps {
  /** Live shotSettings stream, passed to the Steam section so a new pitcher
   *  can seed its parameters from the machine's current settings. */
  shotSettingsStream?: WsStream<ShotSettingsSnapshot>;
}

export const LibraryTab: Component<LibraryTabProps> = (p) => {
  const [section, setSection] = createSignal<SectionId>('recipes');

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
          <Match when={section() === 'routines'}>
            <RoutinesSection />
          </Match>
          <Match when={section() === 'recipes'}>
            <RecipesSection />
          </Match>
          <Match when={section() === 'steam'}>
            <SteamSection shotSettingsStream={p.shotSettingsStream} />
          </Match>
          <Match when={section() === 'beans'}>
            <BeansSection />
          </Match>
          <Match when={section() === 'profiles'}>
            <ProfilesSection />
          </Match>
          <Match when={section() === 'cleanings'}>
            <CleaningsSection />
          </Match>
          <Match when={section() === 'equipment'}>
            <EquipmentSection />
          </Match>
        </Switch>
      </div>
    </div>
  );
};
