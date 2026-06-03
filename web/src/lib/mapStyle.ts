// ─── MapTiler style URL helper — Phase 5c follow-up ──────────────────────
//
// Centralizes the MapTiler tile-style URL for every map in the app
// (SignCard's inset, MapOverview's campus view). Returns the dark
// variant in dark mode and a light variant in light mode so the map
// tiles match the surrounding UI theme rather than fighting it.
//
// The dev-vs-prod base toggle stays here too: in dev we route through
// Vite's `/maptiler` proxy to avoid CORS on localhost; in prod we hit
// `https://api.maptiler.com` directly. The map components only need
// to know `isDark`; they don't need to know about either choice.
//
// Both URL flavours share the same MapTiler API key — pulled from
// `VITE_MAPTILER_KEY`. When the key isn't set, the URL still
// constructs (with `key=` empty) so the caller's downstream error
// path matches the previous behaviour.

const DARK_STYLE = 'streets-v2-dark';
const LIGHT_STYLE = 'streets-v2-light';

/** Construct the full MapTiler style.json URL for the current theme.
 *  Both maps in the app route through this helper so the URL shape
 *  (proxy vs direct, dark vs light, key) is defined once. */
export function getMapStyleUrl(isDark: boolean): string {
  const key =
    (import.meta.env.VITE_MAPTILER_KEY as string | undefined) ?? '';
  const style = isDark ? DARK_STYLE : LIGHT_STYLE;
  // Vite dev proxies /maptiler → api.maptiler.com to dodge CORS on
  // localhost. Production hits MapTiler directly.
  const base = import.meta.env.DEV ? '/maptiler' : 'https://api.maptiler.com';
  return `${base}/maps/${style}/style.json?key=${key}`;
}

/** Exported for tests + the dashboard's read-only style-name display
 *  if it ever wants to surface "currently rendering streets-v2-dark"
 *  as an admin diagnostic. */
export const STYLE_NAMES = {
  dark: DARK_STYLE,
  light: LIGHT_STYLE,
} as const;
