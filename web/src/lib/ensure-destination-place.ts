// ─── B4 — DestinationPlace auto-create ───────────────────────────────────────
//
// When a user types a destination name on a sign, Signal silently ensures a
// first-class DestinationPlace exists for it: case-insensitive name match
// against the project's existing places (link if found), otherwise mint a
// new record. Same name typed on a second sign links to the same record —
// no duplicates.
//
// Coords: per the B4 cowork decision (contained-risk path), an auto-created
// place is seeded with the SIGN's own lat/lng as a stub and flagged
// `coordsStub: true`. The model requires lat/lng (scoring + map depend on
// them), so we can't leave coords absent; the stub keeps the record valid
// and routable while BuildingNames flags it "(needs coords)" for a reviewer
// to place properly. This is a pure helper — persistence (repo.save) and
// row-linking happen at the call site.

import { blankDestinationPlace, type DestinationPlace } from '../platform/index.ts';

/** Canonical match policy (B4 decision 3): trim + lowercase, exact equality.
 *  NOT fuzzy, NOT prefix. "PACKARD HALL" === "packard hall"; "Hall" !==
 *  "Halll". */
export function namesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export interface EnsureDestinationPlaceInput {
  /** The typed destination text. */
  name: string;
  /** The project's current DestinationPlace records (archived excluded). */
  existingPlaces: DestinationPlace[];
  projectId: string;
  /** Stub coords — the sign's own location, used when creating a new place. */
  stubLat: number;
  stubLng: number;
  /** Attribution string for a newly-created record. */
  createdBy: string;
}

export interface EnsureDestinationPlaceResult {
  /** The existing matched place, or the newly created one. */
  place: DestinationPlace;
  /** True when a new record was minted (caller persists it). */
  wasCreated: boolean;
}

/** Ensure a DestinationPlace exists for `name`. Case-insensitive match
 *  against `existingPlaces` (archived skipped); links if found, otherwise
 *  creates a new stub-coords record. */
export function ensureDestinationPlace(
  input: EnsureDestinationPlaceInput,
): EnsureDestinationPlaceResult {
  const existing = input.existingPlaces.find(
    (p) => !p.archivedAt && namesMatch(p.name, input.name),
  );
  if (existing) {
    return { place: existing, wasCreated: false };
  }
  const place = blankDestinationPlace({
    projectId: input.projectId,
    name: input.name.trim(),
    lat: input.stubLat,
    lng: input.stubLng,
    createdBy: input.createdBy,
    coordsStub: true,
  });
  return { place, wasCreated: true };
}

export interface BatchEnsureResult {
  /** One place per input name, in input order (existing match or new). */
  resolved: DestinationPlace[];
  /** Only the newly-minted records — the caller persists these. */
  created: DestinationPlace[];
}

/** Resolve/ensure a DestinationPlace for each name in `names`, in input
 *  order. De-dups WITHIN the batch (a name minted earlier in the same call
 *  is matched, not re-created) as well as against `existingPlaces`. Pure —
 *  the caller persists `created` (existing matches need no write).
 *
 *  Extracted so both "Open in Surface" entry points (SignCard's per-instance
 *  flow via App, and SignTypeEdit's type-level flow) share ONE resolver
 *  instead of each re-deriving the dedup/stub-coords loop. */
export function batchEnsureDestinationPlaces(args: {
  names: string[];
  existingPlaces: DestinationPlace[];
  projectId: string;
  stubLat: number;
  stubLng: number;
  createdBy: string;
}): BatchEnsureResult {
  let working = args.existingPlaces;
  const created: DestinationPlace[] = [];
  const resolved: DestinationPlace[] = [];
  for (const name of args.names) {
    const { place, wasCreated } = ensureDestinationPlace({
      name,
      existingPlaces: working,
      projectId: args.projectId,
      stubLat: args.stubLat,
      stubLng: args.stubLng,
      createdBy: args.createdBy,
    });
    if (wasCreated) {
      created.push(place);
      working = [...working, place];
    }
    resolved.push(place);
  }
  return { resolved, created };
}
