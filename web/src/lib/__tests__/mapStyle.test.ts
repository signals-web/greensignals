// ─── mapStyle tests — Phase I1 (basemap registry) ────────────────────────────
//
// Updated from the Phase-5c MapTiler-only tests: getMapStyleUrl now takes
// (projectBasemapId, { isDark }) and resolves the active basemap through the
// registry. Pins:
//   1. Backward-compat: undefined basemapId → pre-I1 MapTiler Streets, with
//      dark/light auto-switch (the dev `/maptiler` proxy prefix under vitest).
//   2. Explicit basemap resolution (ArcGIS Imagery).
//   3. Unconfigured-provider fallback to the default.
//   4. STYLE_NAMES still surfaces the canonical MapTiler variant ids.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { getMapStyleUrl, resolveActiveBasemap, STYLE_NAMES } from '../mapStyle.ts';

afterEach(() => vi.unstubAllEnvs());

describe('getMapStyleUrl — backward-compat default (no basemapId)', () => {
  it('renders the dark MapTiler Streets style when isDark', () => {
    vi.stubEnv('VITE_MAPTILER_KEY', 'MT');
    expect(getMapStyleUrl(undefined, { isDark: true })).toContain(`/maps/${STYLE_NAMES.dark}/style.json?key=MT`);
  });
  it('renders the light MapTiler Streets style when not isDark', () => {
    vi.stubEnv('VITE_MAPTILER_KEY', 'MT');
    expect(getMapStyleUrl(undefined, { isDark: false })).toContain(`/maps/${STYLE_NAMES.light}/style.json?key=MT`);
  });
  it('dark and light URLs are distinct (no accidental aliasing)', () => {
    expect(getMapStyleUrl(undefined, { isDark: true })).not.toBe(getMapStyleUrl(undefined, { isDark: false }));
  });
  it('carries the key= query param in both modes', () => {
    expect(getMapStyleUrl(undefined, { isDark: true })).toMatch(/[?&]key=/);
    expect(getMapStyleUrl(undefined, { isDark: false })).toMatch(/[?&]key=/);
  });
});

describe('getMapStyleUrl — explicit basemap', () => {
  it('arcgis-imagery renders the ArcGIS Imagery URL when ArcGIS is configured', () => {
    vi.stubEnv('VITE_ARCGIS_API_KEY', 'AG');
    expect(getMapStyleUrl('arcgis-imagery', { isDark: false })).toBe(
      'https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis/imagery?token=AG',
    );
  });
});

describe('resolveActiveBasemap — fallback', () => {
  it('falls back to the default when the selected provider is not configured', () => {
    vi.stubEnv('VITE_ARCGIS_API_KEY', '');
    expect(resolveActiveBasemap('arcgis-imagery').id).toBe('maptiler-streets');
  });
  it('returns the selected basemap when its provider is configured', () => {
    vi.stubEnv('VITE_ARCGIS_API_KEY', 'AG');
    expect(resolveActiveBasemap('arcgis-imagery').id).toBe('arcgis-imagery');
  });
  it('falls back for an unknown id', () => {
    expect(resolveActiveBasemap('totally-made-up').id).toBe('maptiler-streets');
  });
});

describe('STYLE_NAMES', () => {
  it('surfaces the canonical MapTiler variant ids', () => {
    expect(STYLE_NAMES).toEqual({ dark: 'streets-v2-dark', light: 'streets-v2-light' });
  });
});
