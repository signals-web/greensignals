// ─── Inset map bounds — Phase 5c follow-up ────────────────────────────────
//
// Pure helper that computes a `[[swLng, swLat], [neLng, neLat]]`
// bounding box covering the focal sign + every linked destination.
// SignCard hands the result to `map.fitBounds(...)` on initial render
// and on data change so the auto-zoom matches the spread of the
// sign's destinations — wide for Map signs (anchors across campus),
// tight for Nudge signs (3-min walk).
//
// Resolution uses the same `buildDestinationLookup` chain as the
// dashed leader lines (id-first, name-fallback). Both paths land on
// canonical DestinationPlace.lat/lng — no 45° snap, no
// arrow-derived geometry. See the architectural invariant on
// `lib/destinationLinks.ts`.

import { buildDestinationLookup } from './destinationLinks.ts';
import type { DestinationPlace } from '../platform/index.ts';

/** Tuple maplibre's `fitBounds` expects: `[[swLng, swLat], [neLng, neLat]]`. */
export type LngLatBoundsTuple = [
  [number, number],
  [number, number],
];

/** A row reference — uses just the fields the lookup needs.
 *  Compatible with the embedded `Destination` interface. */
export interface RowRef {
  name?: string;
  destinationPlaceId?: string;
}

/** Build a lat/lng bounding box covering the sign + every destination
 *  it references via canonical DestinationPlace coords. Rows that
 *  resolve to nothing (no id, no name match, archived) are skipped —
 *  they don't render on the map either. When zero rows resolve, the
 *  bounds collapse to a point at the sign's coords; maplibre's
 *  `fitBounds` handles that gracefully (it'll respect maxZoom and
 *  centre on the sign). */
export function computeInsetBounds(
  sign: { lat: number; lng: number },
  rows: ReadonlyArray<RowRef>,
  destinations: ReadonlyArray<DestinationPlace>,
): LngLatBoundsTuple {
  const lookup = buildDestinationLookup(destinations);

  let minLat = sign.lat;
  let maxLat = sign.lat;
  let minLng = sign.lng;
  let maxLng = sign.lng;

  const seen = new Set<string>(); // dedupe by DestinationPlace id
  for (const row of rows) {
    const dp = lookup.resolve(row);
    if (!dp) continue;
    if (seen.has(dp.id)) continue;
    seen.add(dp.id);

    if (dp.lat < minLat) minLat = dp.lat;
    else if (dp.lat > maxLat) maxLat = dp.lat;
    if (dp.lng < minLng) minLng = dp.lng;
    else if (dp.lng > maxLng) maxLng = dp.lng;
  }

  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}
