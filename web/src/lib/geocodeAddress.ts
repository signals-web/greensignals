// ─── MapTiler forward geocoding — single-shot resolve ──────────────────────
//
// Thin helper over MapTiler's Geocoding API used by the destinations
// add-form's "Look up address" button. Returns the best single match or
// null. Callers are responsible for user-facing error text — this only
// returns null when the query failed, network errored, or the result set
// was empty. It never throws.
//
// URL shape matches `LocationSearch.tsx` (the existing typeahead) so we
// have one mental model of MapTiler in the codebase. LocationSearch uses
// `limit=5` for the typeahead dropdown; this helper pins `limit=1` because
// the caller wants a single answer, not a picker.
//
// Dev vs prod: Vite's `/maptiler` proxy is used in dev to sidestep CORS
// on localhost; prod hits api.maptiler.com directly. Both paths are
// identical to LocationSearch's — if LocationSearch stops working, this
// helper stops working the same way.

export interface GeocodeHit {
  /** WGS84 latitude. */
  lat: number;
  /** WGS84 longitude. */
  lng: number;
  /** Human-readable place name returned by MapTiler, e.g.
   *  "University of Colorado, Boulder, CO, United States". Shown to the
   *  user so they can sanity-check the match before committing. */
  matchedAddress: string;
}

/** Forward-geocode a free-form address / place name to a single best hit.
 *  Returns null on empty query, missing key, empty result set, or any
 *  network/parse failure. Never throws. */
export async function geocodeAddress(
  query: string,
  maptilerKey: string,
): Promise<GeocodeHit | null> {
  const q = query.trim();
  if (!q || !maptilerKey) return null;

  const base = import.meta.env.DEV ? '/maptiler' : 'https://api.maptiler.com';
  const url = `${base}/geocoding/${encodeURIComponent(q)}.json?key=${maptilerKey}&limit=1`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features?: Array<{
        center?: [number, number];
        place_name?: string;
      }>;
    };
    const first = data.features?.[0];
    if (!first?.center) return null;
    const [lng, lat] = first.center;
    return {
      lat,
      lng,
      matchedAddress: first.place_name ?? q,
    };
  } catch {
    return null;
  }
}
