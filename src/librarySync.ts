import { createSignal, type Accessor } from 'solid-js';
import { api } from './api';
import { BUILD_INFO } from './buildInfo';
import {
  LocalRecipeRepository,
  LocalRoutineRepository,
  LocalPitcherRepository,
  LocalCleaningRepository,
  type RecipeRepository,
  type RoutineRepository,
  type PitcherRepository,
  type CleaningRepository,
} from './repositories';

/**
 * Library storage sync — keeps recipes/routines/pitchers responsive (local
 * mirror) AND durable across devices (gateway KV store is canonical). Full
 * design + rationale in docs/storage-sync.md. v1 covers the three library
 * collections; prefs are deferred.
 *
 * Model: the local repos are the read/write surface (instant, localStorage).
 * Every user mutation bumps a single `meta.updatedAt` and schedules a debounced
 * push of the whole library. On app load + window focus we GET the gateway's
 * `meta` and compare: gateway newer → pull-and-replace; local newer → push.
 * Whole-library last-write-wins; no concurrency handling (single user).
 */

/** The one timestamp + provenance the sync compares. */
interface LibraryMeta {
  updatedAt: number;
  appVersion: string;
}

/** localStorage key for this device's library meta (kept on the existing
 *  `starter-skin.` prefix like the collection keys — see [[starter-skin-name]]). */
const META_KEY = 'starter-skin.library-meta.v1';

export interface LibrarySync {
  repos: {
    recipes: RecipeRepository;
    routines: RoutineRepository;
    pitchers: PitcherRepository;
    cleanings: CleaningRepository;
  };
  /** Bumps on every local mutation and every pull. List resources take this as
   *  a source so a pull (or cross-screen edit) re-renders them. */
  revision: Accessor<number>;
  /** GET meta, compare, then pull-or-push. Run on load + visibilitychange. */
  syncNow: () => Promise<void>;
  /** Flush timers (tests / teardown). */
  dispose: () => void;
}

export interface LibrarySyncOptions {
  storage?: Storage;
  storeGet?: <T>(key: string) => Promise<T | null>;
  storeSet?: (key: string, value: unknown) => Promise<void>;
  appVersion?: string;
  now?: () => number;
  /** Debounce window for coalescing rapid edits into one push (ms). */
  debounceMs?: number;
}

export function createLibrarySync(opts: LibrarySyncOptions = {}): LibrarySync {
  const storage = opts.storage ?? globalThis.localStorage;
  const storeGet = opts.storeGet ?? (<T>(k: string) => api.storeGet<T>(k));
  const storeSet = opts.storeSet ?? ((k: string, v: unknown) => api.storeSet(k, v));
  const appVersion = opts.appVersion ?? BUILD_INFO.version;
  const now = opts.now ?? (() => Date.now());
  const debounceMs = opts.debounceMs ?? 800;

  const [revision, setRevision] = createSignal(0);
  const bump = () => setRevision((n) => n + 1);

  // The local repos are the mirror. Each fires `notifyLocalChange` on a user
  // mutation (NOT on seed/replaceAll). Built here so the callback can be wired
  // before the coordinator object exists.
  const recipes = new LocalRecipeRepository(storage, () => notifyLocalChange());
  const routines = new LocalRoutineRepository(storage, () => notifyLocalChange());
  const pitchers = new LocalPitcherRepository(storage, () => notifyLocalChange());
  const cleanings = new LocalCleaningRepository(storage, () => notifyLocalChange());

  // Uniform read/replace per collection. `read` (for push) returns the whole
  // array; `write` (for pull) replaces it. Casts at the boundary keep the
  // per-type repo APIs intact.
  const collections: ReadonlyArray<{
    key: string;
    read: () => Promise<unknown[]>;
    write: (items: unknown[]) => Promise<void>;
  }> = [
    {
      key: 'recipes',
      read: () => recipes.list() as Promise<unknown[]>,
      write: (a) => recipes.replaceAll(a as never[]),
    },
    {
      key: 'routines',
      read: () => routines.list() as Promise<unknown[]>,
      write: (a) => routines.replaceAll(a as never[]),
    },
    {
      key: 'pitchers',
      read: () => pitchers.list() as Promise<unknown[]>,
      write: (a) => pitchers.replaceAll(a as never[]),
    },
    {
      // v6: steam-purge step added to seeds (a distinct gateway key avoids
      // pulling stale-shaped cleanings back over the new seeds). v5 tweaked
      // durations; v4 the Home-visible set; v3 the calendar-grid reminders;
      // v2 the flat-kind → Clean-steps redesign.
      key: 'cleanings.v6',
      read: () => cleanings.list() as Promise<unknown[]>,
      write: (a) => cleanings.replaceAll(a as never[]),
    },
  ];

  // --- local meta ---
  const readMeta = (): LibraryMeta => {
    const raw = storage.getItem(META_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<LibraryMeta>;
        if (typeof parsed.updatedAt === 'number') {
          return { updatedAt: parsed.updatedAt, appVersion: parsed.appVersion ?? appVersion };
        }
      } catch {
        /* fall through to default */
      }
    }
    // No meta yet → updatedAt 0. Still beats an absent gateway (treated as -1),
    // so a fresh device with seeds bootstraps an empty gateway; a populated
    // gateway (updatedAt > 0) wins and the seeds are pulled over. See the
    // first-run rule in docs/storage-sync.md.
    return { updatedAt: 0, appVersion };
  };
  let meta = readMeta();
  const writeMeta = (m: LibraryMeta): void => {
    meta = m;
    storage.setItem(META_KEY, JSON.stringify(m));
  };

  // --- push / pull / sync ---
  let syncing = false;
  let pushTimer: ReturnType<typeof setTimeout> | undefined;

  const push = async (): Promise<void> => {
    for (const c of collections) {
      await storeSet(c.key, await c.read());
    }
    // Meta last: if it lands, the data already did, so the gateway is never
    // left with a newer meta than its contents.
    const stamped: LibraryMeta = { updatedAt: meta.updatedAt || now(), appVersion };
    await storeSet('meta', stamped);
    writeMeta(stamped);
  };

  const pull = async (gateway: LibraryMeta): Promise<void> => {
    for (const c of collections) {
      const arr = await storeGet<unknown[]>(c.key);
      if (Array.isArray(arr)) await c.write(arr);
    }
    writeMeta({ updatedAt: gateway.updatedAt, appVersion: gateway.appVersion });
    bump();
  };

  const syncNow = async (): Promise<void> => {
    if (syncing) return;
    syncing = true;
    try {
      const gateway = await storeGet<LibraryMeta>('meta');
      const gUpdated = gateway?.updatedAt ?? -1; // absent gateway = oldest
      if (gUpdated > meta.updatedAt) {
        await pull(gateway!);
      } else if (meta.updatedAt > gUpdated) {
        await push();
      }
      // equal → in sync, do nothing
    } catch (e) {
      // Gateway unreachable / transient — stay on the local mirror; the next
      // load/focus retries (and a local edit that failed to push is older on
      // the gateway, so it re-pushes via the compare).
      console.warn('library sync failed', e);
    } finally {
      syncing = false;
    }
  };

  // A user mutation: bump the timestamp + revision now, push on a debounce so a
  // flurry of edits coalesces into one write.
  function notifyLocalChange(): void {
    writeMeta({ updatedAt: now(), appVersion });
    bump();
    if (pushTimer !== undefined) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = undefined;
      if (syncing) return; // a sync is mid-flight; its compare will push
      void push().catch((e) => console.warn('library push failed', e));
    }, debounceMs);
  }

  return {
    repos: { recipes, routines, pitchers, cleanings },
    revision,
    syncNow,
    dispose: () => {
      if (pushTimer !== undefined) clearTimeout(pushTimer);
    },
  };
}
