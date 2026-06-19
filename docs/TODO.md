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

## Machine capabilities (deferred — functional, not just display)

**Status:** deferred. Surfacing `/machine/capabilities` was considered as part
of the machine-info card (Variant B) but rejected as a *display-only* teaser.
Capabilities are worth wiring **functionally**, not listing as text.

- `GET /api/v1/machine/capabilities` returns `[]` on a plain DE1; a Bengle
  returns `["cupWarmer", "integratedScale", "ledStrip", "stopAtWeight"]`. The
  reaprime spec says skins should query it **once after connect** to decide
  which UI to render.
- **`stopAtWeight` is the high-value one:** on a Bengle the firmware can own
  stop-at-weight autonomously (driven by the integrated scale), with the app
  reflecting `WorkflowContext.targetYield` into the SAW MMR. This intersects
  the **Auto-stop** work above — on a `stopAtWeight`-capable machine, OverDose
  could hand the stop to firmware instead of running client-side SAW.
- Other capabilities (`cupWarmer`, `ledStrip`) would gate Bengle-only UI that
  OverDose doesn't have yet.

**Why deferred:** display-only listing invites "why can't I use this?" Capability
detection should land alongside the behavior it gates.
