// ─── Handoff-boundary destination linking ────────────────────────────────────
//
// B4 (`ensure-destination-place.ts`) links typed destinations to first-class
// DestinationPlaces, but only inside SignCard's manual "Save edits" flow —
// gated on a reviewer clicking Save AND the sign carrying coords. Signs that
// were CSV-imported or bulk-generated and never hand-edited keep destinations
// as free text with no `destinationPlaceId`.
//
// Surface's per-zone router (`route-signal-to-zones.ts`) deliberately SKIPS
// any destination without a `destinationPlaceId` ("linked-only" cowork
// decision), so those unlinked rows vanish on handoff — the messaging never
// reaches the instance fillings (diagnosed 2026-06-11). This module closes the
// gap at the LAST point the data is still Signal's: the "Open in Surface"
// handoff. It collects every still-unlinked name across all instances of a
// sign type, lets the host ensure/create the places (reusing B4's stub-coords
// helper), and links the rows by name so the envelope always carries linked
// destinations regardless of how they were authored.
//
// Pure functions only — the async `ensureDestinationPlaces` call + persistence
// live at the call site (SignCard), which holds the host callbacks.

import type { SignInstance, SignSide, Destination } from '../platform/index.ts';

/** The distinct typed-but-unlinked destination names across `instances` —
 *  rows with a non-empty `name` and no `destinationPlaceId`. Trimmed;
 *  de-duplicated case-insensitively (first spelling wins for display). */
export function collectUnlinkedNames(instances: SignInstance[]): string[] {
  const byKey = new Map<string, string>();
  for (const inst of instances) {
    for (const side of inst.sides ?? []) {
      for (const d of side.destinations ?? []) {
        const name = d.name?.trim();
        if (!name || d.destinationPlaceId) continue;
        const key = name.toLowerCase();
        if (!byKey.has(key)) byKey.set(key, name);
      }
    }
  }
  return [...byKey.values()];
}

/** Stub coords for newly-created places: the first instance carrying both
 *  lat + lng. `ensureDestinationPlace` matches existing places by name before
 *  creating, so these coords only seed genuinely-new records (flagged
 *  `coordsStub` for a reviewer to refine). Null when no instance has coords —
 *  the caller then opens the handoff with whatever linkage already exists. */
export function pickStubCoords(
  instances: SignInstance[],
): { lat: number; lng: number } | null {
  for (const inst of instances) {
    if (inst.lat != null && inst.lng != null) {
      return { lat: inst.lat, lng: inst.lng };
    }
  }
  return null;
}

/** Apply a name→placeId map to one instance's sides, stamping
 *  `destinationPlaceId` onto any row that matches by (lowercased, trimmed)
 *  name and isn't already linked. Returns the same instance reference when
 *  nothing changed so callers can skip a needless persist. */
export function linkInstanceByName(
  inst: SignInstance,
  linkByName: Map<string, string>,
): { instance: SignInstance; changed: boolean } {
  let changed = false;
  const sides: SignSide[] = (inst.sides ?? []).map((side) => ({
    ...side,
    destinations: (side.destinations ?? []).map((d: Destination) => {
      const name = d.name?.trim();
      if (!name || d.destinationPlaceId) return d;
      const pid = linkByName.get(name.toLowerCase());
      if (!pid) return d;
      changed = true;
      return { ...d, destinationPlaceId: pid };
    }),
  }));
  return changed ? { instance: { ...inst, sides }, changed } : { instance: inst, changed };
}
