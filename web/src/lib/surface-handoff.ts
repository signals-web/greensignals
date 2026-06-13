// ─── "Open in Surface" handoff — single source of truth ──────────────────────
//
// DIAGNOSE-V2 (2026-06-13): Signal had TWO "Open in Surface" entry points that
// built the handoff envelope DIFFERENTLY:
//
//   • SignCard's  "Open in Surface →"  — linked every still-unlinked
//     destination (commit 9431057, via `link-handoff-destinations`) and shipped
//     ALL placed instances of the type.
//   • SignTypeEdit's "Open in Surface ↗" — shipped the SignType with ZERO
//     instances and NO destination linking.
//
// Surface's per-zone router (`route-signal-to-zones.ts`) skips any destination
// without a `destinationPlaceId` AND skips repeater routing entirely when an
// instance is absent, so the type-editor path could only ever synthesize a
// stub instance with empty fillings — the live "empty slots" bug. This module
// unifies both buttons on ONE linked, instance-carrying path so the emitted
// envelope is identical regardless of which button fired.

import {
  buildHandoffUrl,
  type SignType,
  type SignInstance,
  type SignSide,
  type DestinationPlace,
} from '../platform/index.ts';
import {
  collectUnlinkedNames,
  pickStubCoords,
  linkInstanceByName,
} from './link-handoff-destinations.ts';

/** Ensure/resolve DestinationPlaces for a batch of names, returned in input
 *  order. Existing matches come back unchanged; the host has already
 *  persisted any newly-created records before resolving. */
export type EnsureDestinationPlacesFn = (
  names: string[],
  coords: { lat: number; lng: number },
) => Promise<DestinationPlace[]>;

/** Link every still-unlinked destination across `instances` to a
 *  DestinationPlace, persisting each changed instance via `persistInstance`.
 *
 *  Best-effort by design — a missing `ensurePlaces` callback, absent coords
 *  (no instance carries lat/lng), zero unlinked names, or a thrown error all
 *  leave the instances exactly as-is; the handoff still opens with whatever
 *  linkage already exists. Returns the instances ready to encode. */
export async function linkInstancesForHandoff(args: {
  instances: SignInstance[];
  ensurePlaces?: EnsureDestinationPlacesFn;
  persistInstance?: (id: string, sides: SignSide[]) => void;
}): Promise<SignInstance[]> {
  const { instances, ensurePlaces, persistInstance } = args;
  try {
    const names = collectUnlinkedNames(instances);
    const coords = pickStubCoords(instances);
    if (names.length === 0 || !coords || !ensurePlaces) return instances;
    const places = await ensurePlaces(names, coords);
    const linkByName = new Map<string, string>();
    names.forEach((n, i) => {
      const p = places[i];
      if (p) linkByName.set(n.toLowerCase(), p.id);
    });
    return instances.map((inst) => {
      const { instance: next, changed } = linkInstanceByName(inst, linkByName);
      if (changed) persistInstance?.(inst.id, next.sides);
      return next;
    });
  } catch (err) {
    console.error(
      '[handoff] destination linking failed; opening with current data',
      err,
    );
    return instances;
  }
}

/** Build the "Open in Surface" URL for a sign type, linking the supplied
 *  instances' destinations first. Both entry points call this so the emitted
 *  envelope carries the same linked, instance-bearing payload. */
export async function buildSurfaceHandoffUrl(args: {
  surfaceUrl: string;
  signType: SignType;
  projectId: string;
  instances: SignInstance[];
  ensurePlaces?: EnsureDestinationPlacesFn;
  persistInstance?: (id: string, sides: SignSide[]) => void;
}): Promise<string> {
  const linked = await linkInstancesForHandoff({
    instances: args.instances,
    ensurePlaces: args.ensurePlaces,
    persistInstance: args.persistInstance,
  });
  return buildHandoffUrl(
    args.surfaceUrl,
    args.signType,
    args.projectId,
    undefined,
    linked,
  );
}
