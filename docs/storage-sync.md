# Library storage & gateway sync

How OverDose's library (recipes, routines, pitchers, prefs) stays both
**responsive** (instant local reads/writes) and **durable across devices**
(survives browser resets; an edit on a phone shows up on the machine's tablet).

Read this if you're touching the repository layer, persistence, or anything
that needs to be the same across the devices pointed at one gateway.

## The problem

localStorage is per-browser/per-origin: it doesn't survive a browser reset and
doesn't cross devices. So a recipe authored on a remote device can't be used on
the machine's tablet. The reaprime gateway exposes a persistent key-value store
(`/api/v1/store/{namespace}/{key}`, Hive-backed on the gateway device) that
*is* shared across every client of that gateway. We want local responsiveness
**and** that shared durability.

## Mental model

**The gateway KV store is the canonical library. Each client keeps a local
mirror.** The mirror exists only for instant cold-start reads and tolerance
when the gateway is briefly unreachable. The gateway is the truth; local
converges to it.

> On the **machine's tablet the gateway is localhost** — reads/writes are
> nearly free there, so the mirror barely matters. The mirror earns its keep on
> **remote devices** (LAN/WAN latency) and brief offline windows. We design for
> the remote case; the tablet gets correctness for free.

This is the gateway-backed implementation the repository interface was built
for — see [[starter-skin-storage]]. The interfaces are already async + per-id
CRUD (`list/get/create/update/delete`), so swapping the backing store needs no
call-site changes.

## Layout on the gateway

One namespace, `overdose`, one key per collection, plus a `meta` key:

```
GET /api/v1/store/overdose/recipes     →  Recipe[]   (JSON array)
GET /api/v1/store/overdose/routines    →  Routine[]
GET /api/v1/store/overdose/pitchers    →  Pitcher[]
GET /api/v1/store/overdose/steamPurge  →  { strategy, autoFlushSec }
GET /api/v1/store/overdose/prefs       →  UserPrefs   (aspirational)
GET /api/v1/store/overdose/meta        →  { updatedAt, appVersion }
```

There are **no device-local-only settings.** `hasScale` etc. describe the
*machine* (the scale connects to the gateway, not the skin), so they're the
same for every client and ride along in the synced prefs. (Aside: `hasScale`
would arguably be better *derived* from the live scale-snapshot WS than
persisted at all — separate cleanup, not part of this design.)

> **Status.** `recipes`/`routines`/`pitchers`/`meta` are synced via
> `librarySync`. The **`steamPurge`** key (wand-purge `strategy` + dwell, which
> drive the firmware `steamPurgeMode`) is the first *pref* to go cross-client:
> it's synced as its own key by `UserPrefsContext` (gateway-canonical, pulled on
> mount + window focus, pushed debounced on change; localStorage is the
> cold-start mirror). The general **`prefs` blob is still aspirational** — the
> rest of UserPrefs stay localStorage-only until that lands. `steamPurge`
> collapses into the blob if/when it does.

### The `meta` key

A single object governing the whole namespace:

```json
{ "updatedAt": 1717000000000, "appVersion": "0.0.1" }
```

- **`updatedAt`** — the one timestamp the sync compares. Whole-library
  last-write-wins. Bumped on every local change.
- **`appVersion`** — the OverDose version that last wrote the namespace, from
  `BUILD_INFO.version` (`src/buildInfo.ts`, injected from `package.json` via
  Vite `define`). Stamped on every push. See *App-version handling* below.

A dedicated `meta` key makes the sync check a single cheap read — fetch one
small object, compare, *then* decide to pull or push the data keys. (If each
collection carried its own timestamp instead, deciding would mean fetching
every blob, defeating the point.)

## The flow

**Reads** (`list`/`get`): serve the local mirror synchronously — no spinner,
ever. A refresh, if due, happens in the background and re-renders reactively.

**Writes** (`create`/`update`/`delete`): apply to the local mirror immediately
(optimistic; UI updates now), bump local `updatedAt`, then push to the gateway.

**Sync** — on **load** and on **focus** (`visibilitychange`); no interval
polling:

1. `GET overdose/meta`.
2. Compare gateway `updatedAt` to local:
   - gateway **newer** → pull all collections, replace local.
   - gateway **older** → push all local collections + `meta`.
   - **equal** → do nothing.

Because every local change also pushes immediately, by the time you focus,
this device is usually already in sync. The focus pull is what catches changes
made by **other** devices — and the "gateway older → push" branch doubles as
**offline catch-up**: an edit whose immediate push failed (no network) is older
on the gateway, so the next focus with connectivity pushes it. No separate
outbox needed.

### Latency / freshness

There is **no WS channel for the store** — the gateway can't push library
changes. A second client learns of a change only when it next pulls. With
focus-refresh that's "as soon as you look at the other device," which covers
the author-on-phone → use-on-tablet scenario. Two screens open side by side
won't auto-reconcile until one is refocused; accepted (no interval poll).

## Concurrency

**None handled, by design.** Whole-library last-write-wins on a single
timestamp. Editing recipes on one device and routines on another within the
same window → one clobbers the other. Single-user, few-devices domain; accepted.

## First-run seeding (the one rule that prevents data loss)

A fresh device seeds default recipes with a "now" timestamp. Run naively, that
new device looks *newer* than a real gateway library and would **push default
seeds over your real data.** The rule:

**On first run, pull before seed.**
- Gateway has a library (`meta` exists) → adopt it, **skip seeding**.
- Gateway is empty (no `meta`) → seed locally, then push (this device
  bootstraps the gateway).

Treat "no `meta` on gateway" as the oldest-possible timestamp: an empty gateway
always loses to a real local library, a real gateway always beats fresh seeds.
That single ordering rule makes both first-run directions correct.

## App-version handling

`meta.appVersion` records which OverDose version last wrote the library. It
matters because devices upgrade at different times, creating two cross-version
cases the bare timestamp can't see:

1. **Data from an *older* app than the reader** → reader may need to **migrate**
   the shape forward before use. `appVersion` is the migration trigger.
2. **Data from a *newer* app than the reader** → the dangerous one. An old
   client pulls newer-schema data, edits it, and pushes it back in the old
   schema — silently **downgrading** the library.

### v1 behaviour

Stamp `appVersion` on every write; use it **informationally + as a migration
hook** (read path ready to run a forward-migration when a schema bump lands).
**No version gating built in v1** — pre-1.0, devices are typically upgraded
together, so case 2 is low-risk for now.

### Deferred: downgrade guard (flagged, not built)

When the first breaking schema change lands, add: *if `gateway.appVersion` is
newer than mine, adopt-for-read but **refuse to push** over it.* Requirements
for that guard when built:

- A refused push **must surface to the user** — never fail silently — because
  it will never succeed without action. Prefer a **proactive read-only mode +
  persistent banner** ("Update OverDose to edit your library") over
  accepting an edit and discarding it. A **toast** is the fallback for a write
  that slips through before read-only engages.
- Message must be **actionable**: name the cause (old app) and the fix (update),
  e.g. *"Your changes weren't saved — this device's OverDose is older than the
  version that last updated your library. Update OverDose to make changes."*

Distinguish failure kinds:
- **Transient** push failure (gateway unreachable) → silent; auto-retried on
  next focus via the "gateway older → push" branch.
- **Refused** push (version guard) → must surface, as above.

## Out of scope

- **Profiles** already cross devices via the gateway (gateway-owned —
  [[starter-skin-profiles]]); untouched by this design.
- **Shots** are gateway-persisted already; not part of the library sync.
- Local `*.seeded.v1` bootstrap flags stay local — they're per-device first-run
  markers, not library data.

## Status

**v1 implemented (recipes / routines / pitchers).** `src/librarySync.ts`
(`createLibrarySync`) owns the local repos (the mirror) + the gateway push/pull;
`api.storeGet`/`storeSet` back the KV calls; repos gained `replaceAll` (pull)
and an `onChange` write hook (push). `App.tsx` runs `syncNow()` on load +
`visibilitychange` (and *before* seed-profile linking). Reactivity: a
`revision` signal on `RepositoriesContext`, sourced into the Library list
resources + the Home recipe picker, so a pull re-renders them. Debounced push
(800 ms); `appVersion` stamped, informational only. First-run uses the
"absent gateway = oldest" ordering (seed-then-sync converges correctly).

**Deferred:** `prefs` sync (UserPrefsContext hydrate-from-pull wiring; would
sync all but `debugLogging`), the cross-version **downgrade guard**, and the
keyed single-entity editor / brew-screen resources (they refetch on navigation
rather than live-updating on a pull).
