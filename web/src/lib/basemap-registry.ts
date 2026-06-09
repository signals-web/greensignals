// ─── Basemap provider registry — Phase I1 ────────────────────────────────────
//
// Replaces the single hardcoded MapTiler style path with a small pluggable
// registry of basemap providers. I1 ships two providers — MapTiler (the
// existing default) and ArcGIS Location Platform (the new ESRI wedge) — each
// with a curated short list of basemaps. Both return MapLibre-compatible
// vector style JSON, so the rendering engine (MapLibre GL) is unchanged: I1
// is a style-URL swap, not a rendering-engine swap.
//
// API keys are env-only for I1: VITE_MAPTILER_KEY (existing) and
// VITE_ARCGIS_API_KEY (new). A provider with no key configured is filtered
// out of the picker. Per-project key override is a later phase.

export type BasemapTheme = 'auto' | 'agnostic' | 'light' | 'dark';
export type ProviderId = 'maptiler' | 'arcgis';

export interface BasemapEntry {
  /** Stable id persisted on Project.basemapId. */
  id: string;
  /** Human-facing label shown in the settings dropdown. */
  label: string;
  /** Provider this basemap belongs to. */
  providerId: ProviderId;
  /** Theming model — drives whether isDark affects URL construction. */
  theme: BasemapTheme;
  /** Provider-specific style code(s). For 'auto' themes this is a
   *  { light, dark } pair; for everything else, a single string. */
  styleCode: string | { light: string; dark: string };
}

export interface ProviderConfig {
  id: ProviderId;
  /** True when the provider has a usable API key in env. */
  isConfigured: () => boolean;
  /** Rendered MapLibre-compatible style URL for the entry + theme. */
  buildStyleUrl: (entry: BasemapEntry, opts: { isDark: boolean }) => string;
}

/** The fallback basemap when project.basemapId is undefined or invalid.
 *  Hardcoded to preserve pre-I1 behaviour (MapTiler Streets, auto-themed). */
export const DEFAULT_BASEMAP_ID = 'maptiler-streets';

// ─── Style-code resolution ───────────────────────────────────────────────────

/** Pick the concrete style code for the active theme. 'auto' entries carry
 *  a {light,dark} pair; all others a single string (isDark ignored). */
function resolveStyleCode(entry: BasemapEntry, isDark: boolean): string {
  if (typeof entry.styleCode === 'string') return entry.styleCode;
  return isDark ? entry.styleCode.dark : entry.styleCode.light;
}

// ─── Providers ───────────────────────────────────────────────────────────────

const maptiler: ProviderConfig = {
  id: 'maptiler',
  isConfigured: () => !!(import.meta.env.VITE_MAPTILER_KEY as string | undefined),
  buildStyleUrl: (entry, { isDark }) => {
    const key = (import.meta.env.VITE_MAPTILER_KEY as string | undefined) ?? '';
    const style = resolveStyleCode(entry, isDark);
    // Vite dev proxies /maptiler → api.maptiler.com to dodge CORS on
    // localhost; production hits MapTiler directly. (Shape preserved exactly
    // from the legacy getMapStyleUrl so devtools see identical requests.)
    const base = import.meta.env.DEV ? '/maptiler' : 'https://api.maptiler.com';
    return `${base}/maps/${style}/style.json?key=${key}`;
  },
};

const arcgis: ProviderConfig = {
  id: 'arcgis',
  isConfigured: () => !!(import.meta.env.VITE_ARCGIS_API_KEY as string | undefined),
  buildStyleUrl: (entry, { isDark }) => {
    const key = (import.meta.env.VITE_ARCGIS_API_KEY as string | undefined) ?? '';
    const style = resolveStyleCode(entry, isDark);
    // ArcGIS Basemap Styles v2 service — returns Mapbox/MapLibre style JSON.
    return `https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/${style}?token=${key}`;
  },
};

/** Provider configs keyed by id. */
export const PROVIDERS: Readonly<Record<ProviderId, ProviderConfig>> = {
  maptiler,
  arcgis,
};

// ─── Catalog ─────────────────────────────────────────────────────────────────

/** All basemaps known to the app, in catalog/display order. Ids are STABLE —
 *  persisted as Project.basemapId. */
export const ALL_BASEMAPS: ReadonlyArray<BasemapEntry> = [
  // MapTiler (existing, preserved)
  {
    id: 'maptiler-streets',
    label: 'Streets',
    providerId: 'maptiler',
    theme: 'auto',
    styleCode: { light: 'streets-v2-light', dark: 'streets-v2-dark' },
  },
  { id: 'maptiler-satellite', label: 'Satellite', providerId: 'maptiler', theme: 'agnostic', styleCode: 'hybrid' },
  { id: 'maptiler-outdoor', label: 'Outdoor', providerId: 'maptiler', theme: 'agnostic', styleCode: 'outdoor-v2' },
  { id: 'maptiler-topo', label: 'Topographic', providerId: 'maptiler', theme: 'agnostic', styleCode: 'topo-v2' },
  // ArcGIS Location Platform (new)
  { id: 'arcgis-imagery', label: 'Imagery (aerial)', providerId: 'arcgis', theme: 'agnostic', styleCode: 'arcgis/imagery' },
  {
    id: 'arcgis-streets',
    label: 'Streets (ArcGIS)',
    providerId: 'arcgis',
    theme: 'auto',
    styleCode: { light: 'arcgis/streets', dark: 'arcgis/streets-night' },
  },
  { id: 'arcgis-topographic', label: 'Topographic (ArcGIS)', providerId: 'arcgis', theme: 'agnostic', styleCode: 'arcgis/topographic' },
  {
    id: 'arcgis-gray',
    label: 'Gray Canvas',
    providerId: 'arcgis',
    theme: 'auto',
    styleCode: { light: 'arcgis/light-gray', dark: 'arcgis/dark-gray' },
  },
];

// ─── Lookups ─────────────────────────────────────────────────────────────────

/** Catalog entries whose provider currently has an API key configured. The
 *  settings picker uses this to populate the dropdown. */
export function getAvailableBasemaps(): BasemapEntry[] {
  return ALL_BASEMAPS.filter((e) => PROVIDERS[e.providerId].isConfigured());
}

/** Lookup by id; undefined when the id isn't in the catalog. */
export function getBasemapById(id: string): BasemapEntry | undefined {
  return ALL_BASEMAPS.find((e) => e.id === id);
}
