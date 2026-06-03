// ─── Walking-route fetch — Approach mode helper ────────────────────────
//
// Approach mode wants to show the literal walking path from the current
// sign to a destination, not a straight bearing line. This helper hits
// Mapbox's Directions API on the `walking` profile, returns the route
// geometry as a GeoJSON LineString, and caches by lng/lat pair so a
// reviewer toggling between chips doesn't re-fetch the same route.
//
// If `VITE_MAPBOX_TOKEN` isn't set, the helper returns null and the
// caller falls back to a straight `current → destination` line. That
// keeps Approach mode functional (if visually less informative) without
// a hard dependency on the token being configured.

const TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) ?? '';

/** Module-level cache, keyed by rounded coordinates. Survives
 *  re-renders, doesn't survive a full page reload — that's fine for
 *  a review session. */
const cache = new Map<string, GeoJSONLineString>();

interface GeoJSONLineString {
  type: 'LineString';
  coordinates: Array<[number, number]>;
}

function cacheKey(
  from: readonly [number, number],
  to: readonly [number, number],
): string {
  const r = (n: number) => n.toFixed(5);
  return `${r(from[0])},${r(from[1])}->${r(to[0])},${r(to[1])}`;
}

/** Fetch a walking route between two points. Returns null when the
 *  Mapbox token isn't configured, when the request fails, when the
 *  request is aborted, or when Mapbox returns no route. The caller is
 *  expected to keep showing the straight-line fallback in those cases. */
export async function fetchWalkingRoute(
  from: readonly [number, number],
  to: readonly [number, number],
  signal?: AbortSignal,
): Promise<GeoJSONLineString | null> {
  if (!TOKEN) return null;

  const k = cacheKey(from, to);
  const hit = cache.get(k);
  if (hit) return hit;

  const coords = `${from[0]},${from[1]};${to[0]},${to[1]}`;
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/walking/${coords}` +
    `?geometries=geojson&overview=full&access_token=${encodeURIComponent(TOKEN)}`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    const geom = data?.routes?.[0]?.geometry;
    if (
      !geom ||
      geom.type !== 'LineString' ||
      !Array.isArray(geom.coordinates) ||
      geom.coordinates.length < 2
    ) {
      return null;
    }
    const out: GeoJSONLineString = {
      type: 'LineString',
      coordinates: geom.coordinates,
    };
    cache.set(k, out);
    return out;
  } catch {
    return null;
  }
}

/** Test/diagnostic helper — clears the in-memory cache. Not used in
 *  production code paths but exposed so tests don't leak state. */
export function _clearWalkingRouteCache(): void {
  cache.clear();
}
