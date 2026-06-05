# OverDose — TODO / deferred work

## Auto-stop: gateway-side stop strategy (deferred — needs a reaprime change)

**Status:** deferred. Configurable auto-stop is being built **OverDose-only**
(Approach A): a global "stop mode" + per-shot override that maps to the two
targets OverDose already sends — `workflow.context.targetYield` and
`profile.target_volume`.

**Limitation of the OverDose-only approach:** the gateway (reaprime
`ShotSequencer`) chooses which target applies based on **scale presence** —
stop-at-weight only *with* a scale, stop-at-volume only *without*. So an
OverDose-only setting inherits these traps:

- **Volume** mode silently does nothing when a scale **is** connected (you
  cannot stop by volume while a scale is present).
- **Weight** mode does nothing **without** a scale.

### Suggested Approach B (reaprime / gateway change)

Add an explicit stop strategy to the workflow context that the gateway honors
**regardless of scale**, instead of inferring it from scale presence:

- New optional field: `workflow.context.stopMode: 'auto' | 'weight' | 'volume' | 'none'`
  - `auto` (default) — current behavior (scale → weight, else volume). Fully
    backward compatible.
  - `weight` — stop at `targetYield` (decide a no-scale fallback: none, or volume).
  - `volume` — stop at `target_volume` **even with a scale connected**.
  - `none` — never auto-stop (no SAW / no volume fallback).
- Honor it in `reaprime/lib/src/controllers/shot_sequencer.dart`: the weight
  stop is gated on `scale != null` (~line 287) and the volume fallback on
  `scale == null || _scaleLost` (~line 319). When `stopMode` is provided,
  select the stop by intent instead of by scale presence.
- Backward compatible: absent / `auto` = today's behavior.

**Benefits:** delivers volume-stop-with-a-scale (currently impossible),
removes the "setting that silently does nothing" traps, and makes stop
behavior intent-driven. OverDose's stop-mode setting would then map 1:1 to
`context.stopMode` and behave identically with or without a scale.

**Why deferred:** reaprime is upstream — treat as read-only unless we're
explicitly changing it.
