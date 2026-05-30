import { describe, expect, it } from 'vitest';
import { createLibrarySync } from './librarySync';
import { MemoryStorage } from './test/memoryStorage';

const META_KEY = 'starter-skin.library-meta.v1';
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A fake gateway KV store backed by a Map, exposing the storeGet/storeSet
 *  seams createLibrarySync accepts. */
const fakeGateway = (seed: Record<string, unknown> = {}) => {
  const map = new Map<string, unknown>(Object.entries(seed));
  return {
    map,
    storeGet: async <T>(key: string): Promise<T | null> =>
      map.has(key) ? (map.get(key) as T) : null,
    storeSet: async (key: string, value: unknown): Promise<void> => {
      // Round-trip through JSON like the real HTTP boundary would.
      map.set(key, JSON.parse(JSON.stringify(value)));
    },
  };
};

const mk = (
  storage: MemoryStorage,
  gw: ReturnType<typeof fakeGateway>,
  now = () => 1000,
) =>
  createLibrarySync({
    storage,
    storeGet: gw.storeGet,
    storeSet: gw.storeSet,
    appVersion: 'test-1',
    now,
    debounceMs: 0,
  });

describe('createLibrarySync', () => {
  it('bootstraps an empty gateway: pushes local seeds + stamps meta', async () => {
    const storage = new MemoryStorage(); // repos seed defaults on construct
    const gw = fakeGateway(); // empty gateway → absent meta = oldest
    const sync = mk(storage, gw);

    await sync.syncNow();

    // Every collection + meta pushed, meta stamped with `now`.
    expect(gw.map.has('recipes')).toBe(true);
    expect(gw.map.has('routines')).toBe(true);
    expect(gw.map.has('pitchers')).toBe(true);
    expect((gw.map.get('meta') as { updatedAt: number }).updatedAt).toBe(1000);
    sync.dispose();
  });

  it('pulls when the gateway is newer, replacing local + bumping revision', async () => {
    const storage = new MemoryStorage();
    const gw = fakeGateway({
      meta: { updatedAt: 5000, appVersion: 'other' },
      recipes: [{ id: 'from-gw', name: 'Gateway Recipe', routineId: 'r', overrides: {} }],
      routines: [],
      pitchers: [],
    });
    const sync = mk(storage, gw);
    const before = sync.revision();

    await sync.syncNow();

    const recipes = await sync.repos.recipes.list();
    expect(recipes).toEqual([
      { id: 'from-gw', name: 'Gateway Recipe', routineId: 'r', overrides: {} },
    ]);
    // Routines/pitchers replaced with the gateway's (empty) copies.
    expect(await sync.repos.routines.list()).toEqual([]);
    expect(sync.revision()).toBeGreaterThan(before);
    // Local meta now mirrors the gateway's.
    expect(JSON.parse(storage.getItem(META_KEY)!).updatedAt).toBe(5000);
    sync.dispose();
  });

  it('pushes when local is newer than the gateway', async () => {
    const storage = new MemoryStorage();
    // Local already changed at t=9000; gateway is older.
    storage.setItem(META_KEY, JSON.stringify({ updatedAt: 9000, appVersion: 'test-1' }));
    const gw = fakeGateway({ meta: { updatedAt: 5000, appVersion: 'old' } });
    const sync = mk(storage, gw);

    await sync.syncNow();

    expect((gw.map.get('meta') as { updatedAt: number }).updatedAt).toBe(9000);
    expect(gw.map.has('recipes')).toBe(true);
    sync.dispose();
  });

  it('does nothing when timestamps are equal', async () => {
    const storage = new MemoryStorage();
    storage.setItem(META_KEY, JSON.stringify({ updatedAt: 5000, appVersion: 'test-1' }));
    const gw = fakeGateway({ meta: { updatedAt: 5000, appVersion: 'test-1' } });
    const sync = mk(storage, gw);

    await sync.syncNow();

    // Gateway untouched (no data keys written).
    expect(gw.map.has('recipes')).toBe(false);
    sync.dispose();
  });

  it('a local mutation bumps revision and pushes (debounced)', async () => {
    const storage = new MemoryStorage();
    const gw = fakeGateway({ meta: { updatedAt: 1, appVersion: 'test-1' } });
    let t = 7000;
    const sync = mk(storage, gw, () => t);
    const before = sync.revision();

    await sync.repos.recipes.create({
      id: 'new-1',
      name: 'New',
      routineId: 'r',
      overrides: {},
    });
    expect(sync.revision()).toBeGreaterThan(before); // optimistic bump
    t = 8000;
    await tick(); // let the 0ms debounce fire

    const pushed = gw.map.get('recipes') as Array<{ id: string }>;
    expect(pushed.some((r) => r.id === 'new-1')).toBe(true);
    expect((gw.map.get('meta') as { updatedAt: number }).updatedAt).toBe(7000);
    sync.dispose();
  });

  it('pulling (replaceAll) does not push back', async () => {
    const storage = new MemoryStorage();
    const gw = fakeGateway({
      meta: { updatedAt: 5000, appVersion: 'other' },
      recipes: [],
      routines: [],
      pitchers: [],
    });
    const sync = mk(storage, gw);

    await sync.syncNow(); // pulls
    // After a pull, the gateway meta must remain the pulled value — a pull that
    // triggered onChange would have re-stamped it with `now` (1000).
    await tick();
    expect((gw.map.get('meta') as { updatedAt: number }).updatedAt).toBe(5000);
    sync.dispose();
  });
});
