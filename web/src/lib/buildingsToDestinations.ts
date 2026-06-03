// B1 Bug #4/#5 — bridge imported Buildings into scored DestinationPlaces.
//
// Root cause of the Tufts "data imported but no messaging" bug: the
// Buildings import wrote to `project.buildings`, a collection nothing
// else reads. The schedule generator scores against
// `DestinationPlace[]`, which buildings never populated — so a Tufts
// import produced zero destinations and `generateAllSignSchedules` had
// nothing to point signs at.
//
// Per the DestinationPlace model doc ("a named place a sign points to —
// buildings, amenities, landmarks"), a building IS a destination place.
// This helper upserts a DestinationPlace per imported Building so the
// generator can score them. Dedup is by case-insensitive name so a
// re-import updates coordinates / category in place instead of creating
// duplicates (blankDestinationPlace mints a fresh random id each call,
// which would otherwise pile up on every re-import).
//
// Decision (B1, 2026-06): bridge-on-import (Option A). A dedicated
// DestinationPlace import path (so the Tufts sheet imports as
// destinations directly, preserving Dest ID) is the longer-term plan
// Chris flagged separately; this unblocks messaging now without an
// importer redesign.

import {
  blankDestinationPlace,
  type Building,
  type DestinationPlace,
} from '../platform/index.ts';

export interface BridgeOptions {
  projectId: string;
  /** Display name stamped onto `createdBy`/`updatedBy` of any newly
   *  minted DestinationPlace (matches the manual-add path). */
  createdBy: string;
}

export interface BridgeResult {
  /** The full DestinationPlace list after the merge (existing + new /
   *  updated). Caller sets this as the destinations state. */
  merged: DestinationPlace[];
  /** Only the destinations created or updated by this merge. Caller
   *  persists exactly these via the repo, rather than re-writing the
   *  whole list. */
  upserted: DestinationPlace[];
}

/** Merge a set of imported Buildings into an existing DestinationPlace
 *  list.
 *
 *  - Buildings without coordinates are skipped (a destination can't be
 *    scored or mapped without lat/lng) — they still live on
 *    `project.buildings`, just not in the scored set.
 *  - An existing destination with the same (trimmed, lowercased) name
 *    is updated in place: coordinates refreshed, category refreshed
 *    when the building carries one, id/tier/anchor flags preserved.
 *  - Otherwise a fresh DestinationPlace is minted (tier 'building').
 *
 *  Order: existing destinations keep their position; brand-new ones are
 *  appended in building order. */
export function mergeBuildingsIntoDestinations(
  buildings: readonly Building[],
  existing: readonly DestinationPlace[],
  opts: BridgeOptions,
): BridgeResult {
  const merged: DestinationPlace[] = [...existing];
  const upserted: DestinationPlace[] = [];
  const indexByName = new Map<string, number>();
  merged.forEach((d, i) => indexByName.set(d.name.trim().toLowerCase(), i));

  for (const b of buildings) {
    if (b.lat == null || b.lng == null) continue;
    const key = b.name.trim().toLowerCase();
    if (!key) continue;

    const existingIdx = indexByName.get(key);
    if (existingIdx !== undefined) {
      const prior = merged[existingIdx]!;
      const updated: DestinationPlace = {
        ...prior,
        lat: b.lat,
        lng: b.lng,
        ...(b.category ? { category: b.category } : {}),
        updatedAt: new Date().toISOString(),
        updatedBy: opts.createdBy,
      };
      merged[existingIdx] = updated;
      upserted.push(updated);
    } else {
      const dp = blankDestinationPlace({
        projectId: opts.projectId,
        name: b.name,
        lat: b.lat,
        lng: b.lng,
        tier: 'building',
        ...(b.category ? { category: b.category } : {}),
        createdBy: opts.createdBy,
      });
      indexByName.set(key, merged.length);
      merged.push(dp);
      upserted.push(dp);
    }
  }

  return { merged, upserted };
}
