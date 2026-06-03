// ─── Nearby overlap analysis — Phase 5d v2 ─────────────────────────────
//
// Replaces `nearbyAnalysis.ts`. The earlier module framed comparison as
// CONFLICT detection (different arrows / walk-times = bug). That mental
// model is wrong for environmental graphic design: overlapping signage
// IS the system's job. A hundred Nudges all pointing to "Norlin Library"
// from different positions on campus is not a hundred bugs — it's a
// network of mutually reinforcing wayfinding cues.
//
// This module returns the spatial picture without algorithmic flagging:
//
//   - `nearbySigns` — every sign within `maxDistanceMeters`, sorted
//     ascending by distance, with bearing from the current sign.
//   - `sharedDestinations` — destinations on the current sign that ALSO
//     appear on at least one neighbour, with the list of covering
//     neighbours per destination. Sorted by neighbour count descending
//     (most-shared first).
//
// What this module deliberately does NOT do:
//
//   - Compare arrows or walk-times across signs. Differences are
//     expected and not "conflicts."
//   - Compute "redundancy" by checking whether a closer neighbour
//     covers a destination — that framing said overlap was a bug.
//   - Route-consistency / hierarchy-aware coverage rules — that's
//     Phase 5e and requires a different (harder) model.
//
// Pure function. No IO. Reviewers consume the result via
// NeighborhoodPanel.

import type { DestinationPlace, SignInstance } from '../platform/index.ts';
import { haversineDistance } from '../platform/index.ts';

// ─── Result shape ────────────────────────────────────────────────────────

export interface NearbySign {
  sign: SignInstance;
  /** Straight-line distance from the current sign, in metres. */
  distanceMeters: number;
  /** Compass bearing from the current sign to this neighbour, in
   *  degrees clockwise from true north (0 = N, 90 = E, 180 = S, 270 = W).
   *  Drives the "322 ft NE" caption in the panel. */
  bearingDegrees: number;
}

export interface SharedDestination {
  destination: DestinationPlace;
  /** Sign instances (NEIGHBOURS only — the current sign is implicit)
   *  that have this destination on at least one side, by
   *  `destinationPlaceId`. Sorted by distance ascending so the panel
   *  can render closer reinforcers first. */
  coveringNeighbors: SignInstance[];
}

export interface NeighborhoodAnalysis {
  nearbySigns: NearbySign[];
  sharedDestinations: SharedDestination[];
}

// ─── Inputs ──────────────────────────────────────────────────────────────

export interface AnalyzeNeighborhoodArgs {
  current: SignInstance;
  allSigns: SignInstance[];
  destinations: DestinationPlace[];
  /** Catchment radius. Default 200 m — roughly a 2–3 minute walk, the
   *  range over which a pedestrian's wayfinding decisions actually
   *  cluster. Earlier 500 m default produced 25+ neighbours on CU
   *  Boulder's main campus, drowning the inset map and the row list.
   *  Override per-sign-type when scoring policy demands a wider scan. */
  maxDistanceMeters?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Bearing from `from` to `to` in degrees clockwise from true north.
 *  Standard great-circle initial bearing — we don't need accuracy past
 *  a few degrees because the panel only renders 8-point compass labels.
 *  Exported so the NeighborhoodPanel's "corridor" connector mode can
 *  filter neighbours whose bearing aligns with a destination's. */
export function bearingFromTo(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(from.lat);
  const φ2 = toRad(to.lat);
  const Δλ = toRad(to.lng - from.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Collect every destinationPlaceId on a sign across both sides.
 *  Dedupes so a destination on both faces counts once. */
function destPlaceIdsOnSign(s: SignInstance): Set<string> {
  const ids = new Set<string>();
  for (const side of s.sides) {
    for (const row of side.destinations) {
      if (row.destinationPlaceId) ids.add(row.destinationPlaceId);
    }
  }
  return ids;
}

// ─── Main entry point ────────────────────────────────────────────────────

export function analyzeNeighborhood(
  args: AnalyzeNeighborhoodArgs,
): NeighborhoodAnalysis {
  const { current, allSigns, destinations } = args;
  const maxDistanceMeters = args.maxDistanceMeters ?? 200;

  // ── nearbySigns ────────────────────────────────────────────────────
  const nearbySigns: NearbySign[] = [];
  if (current.lat != null && current.lng != null) {
    const here = { lat: current.lat, lng: current.lng };
    for (const s of allSigns) {
      if (s.id === current.id) continue;
      if (s.lat == null || s.lng == null) continue;
      const there = { lat: s.lat, lng: s.lng };
      const distanceMeters = haversineDistance(here, there);
      if (distanceMeters > maxDistanceMeters) continue;
      nearbySigns.push({
        sign: s,
        distanceMeters,
        bearingDegrees: bearingFromTo(here, there),
      });
    }
    nearbySigns.sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  // ── sharedDestinations ─────────────────────────────────────────────
  // Walk the current sign's destinations (by id), check which neighbours
  // also have that id, and assemble the result.
  const currentIds = destPlaceIdsOnSign(current);
  const dpById = new Map<string, DestinationPlace>();
  for (const dp of destinations) {
    if (!dp.archivedAt) dpById.set(dp.id, dp);
  }

  const sharedDestinations: SharedDestination[] = [];
  for (const id of currentIds) {
    const dp = dpById.get(id);
    if (!dp) continue; // archived or unknown — skip silently

    const covering: SignInstance[] = [];
    for (const ns of nearbySigns) {
      if (destPlaceIdsOnSign(ns.sign).has(id)) covering.push(ns.sign);
    }
    if (covering.length === 0) continue;

    sharedDestinations.push({ destination: dp, coveringNeighbors: covering });
  }

  // Most-shared first; tie-break on destination name for stable output.
  sharedDestinations.sort((a, b) => {
    const d = b.coveringNeighbors.length - a.coveringNeighbors.length;
    if (d !== 0) return d;
    return a.destination.name.localeCompare(b.destination.name);
  });

  return { nearbySigns, sharedDestinations };
}

// ─── Display helpers (used by NeighborhoodPanel) ─────────────────────────

/** Format a bearing as an 8-point compass label (N, NE, E, SE, …). */
export function bearingToCompass8(deg: number): string {
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(((deg % 360) / 45)) % 8;
  return points[idx]!;
}

/** Convert metres to feet, rounded — matches the rest of Signal's UI
 *  (CU Boulder + Tufts both use US customary). */
export function metresToFeet(m: number): number {
  return Math.round(m * 3.28084);
}
