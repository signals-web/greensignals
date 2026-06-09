// ─── Active-basemap resolver — Phase I1 ──────────────────────────────────────
//
// The single style-URL seam for every map in Signal v2 (SignCard's inset,
// MapOverview's campus view). Pre-I1 this hardcoded a MapTiler Streets URL;
// I1 resolves the active basemap through the provider registry, keyed off
// the per-project `Project.basemapId`. Undefined basemapId → DEFAULT_BASEMAP_ID
// (MapTiler Streets, dark/light auto-switch) so pre-I1 projects render
// identically.

import {
  getBasemapById,
  DEFAULT_BASEMAP_ID,
  PROVIDERS,
  type BasemapEntry,
} from './basemap-registry.ts';

/** Resolve the active basemap. `project.basemapId` wins when set AND it
 *  references a known catalog entry whose provider is configured; otherwise
 *  the default (MapTiler Streets). */
export function resolveActiveBasemap(
  projectBasemapId: string | undefined,
): BasemapEntry {
  const fallback = getBasemapById(DEFAULT_BASEMAP_ID)!;
  if (!projectBasemapId) return fallback;
  const entry = getBasemapById(projectBasemapId);
  if (!entry) return fallback;
  if (!PROVIDERS[entry.providerId].isConfigured()) return fallback;
  return entry;
}

/** Render the MapLibre-compatible style URL for the active basemap.
 *  Replaces the legacy `getMapStyleUrl(isDark)` entry point — callers now
 *  pass the project's basemapId. */
export function getMapStyleUrl(
  projectBasemapId: string | undefined,
  opts: { isDark: boolean },
): string {
  const entry = resolveActiveBasemap(projectBasemapId);
  return PROVIDERS[entry.providerId].buildStyleUrl(entry, opts);
}

// Derived from the catalog's default entry — preserved for callers/tests
// that inspect the legacy MapTiler style names as an admin diagnostic.
const defaultEntry = getBasemapById(DEFAULT_BASEMAP_ID)!;
export const STYLE_NAMES: { dark: string; light: string } =
  typeof defaultEntry.styleCode === 'string'
    ? { dark: defaultEntry.styleCode, light: defaultEntry.styleCode }
    : { dark: defaultEntry.styleCode.dark, light: defaultEntry.styleCode.light };
