// ─── Bulk schedule generator — Phase 4 ─────────────────────────────────────
//
// Runs the per-side scoring algorithm across every sign in a project
// and produces updated SignInstance records with auto-generated
// destination rows on each face. Pure function — caller persists via
// existing repos.
//
// Manual rows are preserved unless the caller requests `replace-all`.
// The contract is: a row is "manual" when its `auto` flag is anything
// other than `true` — that's the signal the reviewer touched it (or
// added it by hand), and the next regeneration should respect that.
//
// Storage shape: SignInstance.sides is the persisted form (split into
// FRONT / BACK by the existing `splitSides()` helper). The generator
// flattens a sign's existing destinations, merges the new auto rows
// in, and runs `splitSides()` to write back the proper SignSide pair.
// That keeps the storage format identical to what SignCard's
// edit-and-save path produces — the reviewer can edit a generated
// schedule and save without round-trip glitches.

import {
  DEFAULT_POLICY,
  policyForSignType,
  scoreDestinationsPerSide,
  type SignTypePolicy,
} from '@sosisu/platform/scoring';
import type {
  Destination,
  DestinationPlace,
  FacingDirection,
  ScoringConfig,
  SignInstance,
  SignSide,
  SignType,
} from '@sosisu/platform/models';
import { FACING_DEG, splitSides } from './directions.ts';
import { bearingToArrow, snapTo45, walkTimeEstimate } from './sideMath.ts';

export type ReplaceMode = 'replace-auto' | 'replace-all';

export interface GenerationSummary {
  /** Signs that had at least one row written (so any sign that wasn't
   *  skipped for missing coords / facing). */
  signsProcessed: number;
  /** Total auto rows written across all signs. */
  rowsGenerated: number;
  /** Auto rows from the previous generation that were dropped to make
   *  room for the new ones. Counts apply to `replace-auto` mode; in
   *  `replace-all` mode this counts every dropped row regardless of
   *  flag. */
  autoRowsReplaced: number;
  /** Manual rows kept across the regeneration (always 0 in
   *  `replace-all` mode). */
  manualRowsPreserved: number;
  /** Signs missing `lat` / `lng` / `facing` — the algorithm has
   *  nothing to score against, so they're left alone with whatever
   *  destinations they already had. */
  signsSkipped: number;
}

export interface GenerateAllArgs {
  instances: SignInstance[];
  destinations: DestinationPlace[];
  /** Sign types in the project. Required for Phase 5 policy dispatch:
   *  the generator looks up `signType.code` per instance to derive the
   *  per-side cap and anchors-only filter. Pass an empty array to fall
   *  back to DEFAULT_POLICY for every sign (matches pre-Phase-5
   *  behaviour with cap=4 and no anchor filter). */
  signTypes: readonly SignType[];
  config: ScoringConfig;
  mode: ReplaceMode;
  /** Override the wall clock so tests can assert deterministic
   *  `updatedAt` values. */
  now?: Date;
}

export interface GenerateAllResult {
  updatedInstances: SignInstance[];
  summary: GenerationSummary;
}

/** Flatten the destination rows on a sign (across both sides) into a
 *  single array. Mirrors `flattenDests` in SignCard.tsx but lives
 *  here so the generator doesn't depend on a UI module. */
function flattenSides(sides: SignSide[]): Destination[] {
  return sides.flatMap((s) => s.destinations);
}

/** Forbidden display rotations on the front face. After splitSides'
 *  view-frame transform, these correspond to ↘ ↓ ↙ — arrows that
 *  visually point "below the horizon" on the rendered sign face,
 *  which under the up=forward EGD convention means "walk backward."
 *  The same set is forbidden on the back face: both faces render
 *  with up=forward (just for different real-world directions). */
const FORBIDDEN_DISPLAY_DEGS = new Set([45, 90, 135]);

/** Build a fresh auto row from a scored destination.
 *
 *  The persisted `arrow` is in *world frame* (compass-derived screen
 *  rotation, snapped to 45°). The view-frame transform happens in
 *  `splitSides()` at render time — it both classifies the row to a
 *  side and rotates the arrow into the pedestrian-view of that side.
 *
 *  Earlier iterations of this function did the back-side reflection
 *  and forward-hemisphere clamp at write time. That worked against
 *  splitSides: the reflected arrow no longer matched its real-world
 *  direction, so splitSides re-classified the row to a side it
 *  didn't belong on. Persisting world-frame and trusting splitSides
 *  to handle both classification and view-frame rendering keeps the
 *  two layers consistent.
 *
 *  Dev-mode assertion (below) is the safety net: if the algorithm
 *  ever produces a row that would render in {↘, ↓, ↙} on its
 *  assigned face, throw so the bug is caught at write time, not by
 *  Chris noticing on the screen. */
function buildAutoRow(
  score: { destinationId: string; bearingDegrees: number; distanceMetres: number },
  destination: DestinationPlace,
  side: 'front' | 'back',
  facing: FacingDirection,
): Destination {
  const arrow = snapTo45(bearingToArrow(score.bearingDegrees));

  if (import.meta.env.DEV) {
    // Compute the displayArrow exactly as splitSides will. For the
    // front face: rotate the world-frame arrow so the facing
    // direction maps to "up" (270 in screen-degrees). For the back
    // face: reflect first, then rotate against the opposite facing.
    // The forbidden set is the same on both faces — both render
    // with up=forward.
    const facingScreen = (FACING_DEG[facing] - 90 + 360) % 360;
    const baseArrow = side === 'front' ? arrow : (arrow + 180) % 360;
    const wouldDisplay = (baseArrow - facingScreen + 270 + 360) % 360;
    if (FORBIDDEN_DISPLAY_DEGS.has(wouldDisplay)) {
      throw new Error(
        `[scheduleGenerator] auto row would render backward on ${side} of ` +
          `${facing}-facing sign: destination=${destination.id}, ` +
          `bearing=${score.bearingDegrees.toFixed(1)}°, ` +
          `arrow=${arrow}, displayArrow=${wouldDisplay}°. This means ` +
          `scoreDestinationsPerSide partitioned the row to a side ` +
          `splitSides will render as backward — fix the algorithm, ` +
          `not the row.`,
      );
    }
  }

  const walkTime = walkTimeEstimate(score.distanceMetres);
  return {
    arrow,
    name: destination.name,
    destinationPlaceId: destination.id,
    auto: true,
    ...(walkTime !== undefined && { walkTime }),
  };
}

export function generateAllSignSchedules(
  args: GenerateAllArgs,
): GenerateAllResult {
  // Phase 5: `config` is still part of the argument shape for
  // forward-compatibility (sub-score weights / tier max distances
  // belong on the project-level config), but the per-side cap that
  // used to live on it moved to the per-sign-type policy table. The
  // weights / tier maxes are still read by the underlying
  // `scoreDestinations`, just via constants in that module today —
  // the wiring will catch up when those become tunable.
  const { instances, destinations, mode, signTypes } = args;
  const now = (args.now ?? new Date()).toISOString();
  // Per-instance policy lookup. Map signs filter to anchors only and
  // use a wider per-side cap, while directional signs (PM, SD, N)
  // consider every destination with type-specific caps.
  const signTypeById = new Map(signTypes.map((st) => [st.id, st]));
  // Defensive incoming-array dedup. `App.tsx`'s destinations state
  // should never have duplicates (the repo's `subscribe` replaces
  // wholesale), but if a future regression starts feeding stacked
  // snapshots in here, we want the generator to be the last line of
  // defence rather than silently emitting the same destinationId
  // multiple times.
  const liveDestinations: DestinationPlace[] = [];
  const seenIncomingIds = new Set<string>();
  for (const d of destinations) {
    if (d.archivedAt) continue;
    if (seenIncomingIds.has(d.id)) continue;
    seenIncomingIds.add(d.id);
    liveDestinations.push(d);
  }
  const destLookup = new Map(liveDestinations.map((d) => [d.id, d]));

  const summary: GenerationSummary = {
    signsProcessed: 0,
    rowsGenerated: 0,
    autoRowsReplaced: 0,
    manualRowsPreserved: 0,
    signsSkipped: 0,
  };

  const updatedInstances: SignInstance[] = [];

  for (const instance of instances) {
    // Soft-deleted signs pass through untouched — the caller hands us the
    // full ledger and persists `updatedInstances` wholesale, so dropping
    // (or regenerating) archived records here would corrupt the store.
    // They don't count as "skipped" either: skipped surfaces in the
    // user-facing summary, and a deleted sign isn't news.
    if (instance.archivedAt) {
      updatedInstances.push(instance);
      continue;
    }
    if (instance.lat == null || instance.lng == null || !instance.facing) {
      summary.signsSkipped++;
      updatedInstances.push(instance);
      continue;
    }

    const existing = flattenSides(instance.sides);
    const existingAuto = existing.filter((r) => r.auto === true);
    const existingManual = existing.filter((r) => r.auto !== true);

    // Phase 5: resolve per-sign-type policy. Falls back to
    // DEFAULT_POLICY when the sign references an archived / missing
    // type — the algorithm still produces output rather than skipping
    // the sign, which matches the pre-Phase-5 behaviour.
    const signType = signTypeById.get(instance.signTypeId);
    const policy: SignTypePolicy = signType
      ? policyForSignType(signType)
      : DEFAULT_POLICY;

    // Score and partition. The policy controls anchor-only filtering
    // (Map signs only) and the per-side cap.
    const perSide = scoreDestinationsPerSide({
      projectId: '', // unused by the algorithm
      signInstance: instance,
      ...(instance.neighborhood && { signDistrict: instance.neighborhood }),
      candidates: liveDestinations,
      policy,
    });

    // Merge per the requested mode. Manual rows go first so they
    // anchor the order; auto rows append. `splitSides()` then re-runs
    // the front/back classification at write time so the storage
    // format matches the existing edit path.
    const newAutoRows: Destination[] = [
      ...perSide.front.map((s) => {
        const dest = destLookup.get(s.destinationId);
        return dest ? buildAutoRow(s, dest, 'front', instance.facing!) : null;
      }),
      ...perSide.back.map((s) => {
        const dest = destLookup.get(s.destinationId);
        return dest ? buildAutoRow(s, dest, 'back', instance.facing!) : null;
      }),
    ].filter((r): r is Destination => r !== null);

    let merged: Destination[];
    if (mode === 'replace-all') {
      merged = newAutoRows;
      summary.autoRowsReplaced += existing.length;
    } else {
      // Default — drop only auto rows; preserve manual rows.
      merged = [...existingManual, ...newAutoRows];
      summary.autoRowsReplaced += existingAuto.length;
      summary.manualRowsPreserved += existingManual.length;
    }

    // Re-split into FRONT / BACK using the same helper SignCard's
    // edit-save path uses. Storage format stays identical.
    const [front, back] = splitSides(merged, instance.facing);

    // Three things happen here, in this order, on the rows splitSides
    // emits per side:
    //
    //   (a) Cross-side dedup. splitSides' "perpendicular" branch
    //       (67.5°–112.5° off facing) deliberately pushes a row to
    //       both faces so a destination at right angles is visible
    //       from either approach. For bulk auto-generation that's a
    //       duplication bug — scoreDestinationsPerSide already chose
    //       the side each row belongs on. Front wins; any row that
    //       also appeared on front is dropped from back.
    //   (b) Within-side dedup. Defensive only — splitSides shouldn't
    //       push the same id twice on the same side, but if it ever
    //       regresses, the generator still can't emit duplicates.
    //   (c) Per-side cap. Manual rows always pass through; auto rows
    //       are bounded by `policy.capacityPerSide` minus the number of
    //       manual rows on that side. The cap is the visible
    //       "diagnostic counter" cap in SignCard.
    //
    // Order within a side is preserved: manual rows first (their
    // position in `existingManual`), then auto rows in score order
    // (newAutoRows is `[front-scored, back-scored]`, so the higher-
    // scoring rows come first within each face).
    const seenAcrossSides = new Set<string>();
    const buildSide = (rows: typeof front.destinations) => {
      const manualOut: typeof front.destinations = [];
      const autoOut: typeof front.destinations = [];
      for (const r of rows) {
        if (r.destinationPlaceId) {
          if (seenAcrossSides.has(r.destinationPlaceId)) continue;
          seenAcrossSides.add(r.destinationPlaceId);
        }
        if (r.auto === true) autoOut.push(r);
        else manualOut.push(r);
      }
      const autoSlots = Math.max(0, policy.capacityPerSide - manualOut.length);
      return [...manualOut, ...autoOut.slice(0, autoSlots)];
    };
    const frontRows = buildSide(front.destinations);
    const backRows = buildSide(back.destinations);

    const newSides: SignSide[] = [
      {
        label: `${front.label} · ${front.compass}`,
        destinations: frontRows.map(splitDestToDestination),
      },
      {
        label: `${back.label} · ${back.compass}`,
        destinations: backRows.map(splitDestToDestination),
      },
    ];

    summary.signsProcessed++;
    summary.rowsGenerated += newAutoRows.length;
    updatedInstances.push({
      ...instance,
      sides: newSides,
      updatedAt: now,
    });
  }

  return { updatedInstances, summary };
}

/** SplitDest carries display-only fields (displayArrow, reflected,
 *  clamped) that don't belong on the persisted Destination. Strip
 *  them at write time. */
function splitDestToDestination(d: {
  arrow: number | null;
  name: string;
  walkTime?: string;
  destinationPlaceId?: string;
  auto?: boolean;
}): Destination {
  return {
    arrow: d.arrow,
    name: d.name,
    ...(d.walkTime !== undefined && { walkTime: d.walkTime }),
    ...(d.destinationPlaceId !== undefined && {
      destinationPlaceId: d.destinationPlaceId,
    }),
    ...(d.auto !== undefined && { auto: d.auto }),
  };
}
