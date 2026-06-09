// Phase I1 — basemap provider registry. Env keys are stubbed per case so the
// "which providers are configured" logic is deterministic.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getAvailableBasemaps,
  getBasemapById,
  PROVIDERS,
  DEFAULT_BASEMAP_ID,
} from '../basemap-registry.ts';

afterEach(() => vi.unstubAllEnvs());

describe('getAvailableBasemaps', () => {
  it('returns only the 4 MapTiler basemaps when only VITE_MAPTILER_KEY is set', () => {
    vi.stubEnv('VITE_MAPTILER_KEY', 'mt');
    vi.stubEnv('VITE_ARCGIS_API_KEY', '');
    const avail = getAvailableBasemaps();
    expect(avail).toHaveLength(4);
    expect(avail.every((e) => e.providerId === 'maptiler')).toBe(true);
  });

  it('returns all 8 when both keys are set', () => {
    vi.stubEnv('VITE_MAPTILER_KEY', 'mt');
    vi.stubEnv('VITE_ARCGIS_API_KEY', 'ag');
    expect(getAvailableBasemaps()).toHaveLength(8);
  });

  it('returns [] when no keys are set', () => {
    vi.stubEnv('VITE_MAPTILER_KEY', '');
    vi.stubEnv('VITE_ARCGIS_API_KEY', '');
    expect(getAvailableBasemaps()).toEqual([]);
  });
});

describe('buildStyleUrl', () => {
  it('MapTiler streets renders the dev-proxy/prod MapTiler style URL (light variant)', () => {
    vi.stubEnv('VITE_MAPTILER_KEY', 'MTKEY');
    const streets = getBasemapById('maptiler-streets')!;
    expect(PROVIDERS.maptiler.buildStyleUrl(streets, { isDark: false })).toContain(
      '/maps/streets-v2-light/style.json?key=MTKEY',
    );
  });

  it('MapTiler streets picks the dark variant under isDark (auto theme)', () => {
    vi.stubEnv('VITE_MAPTILER_KEY', 'MTKEY');
    const streets = getBasemapById('maptiler-streets')!;
    expect(PROVIDERS.maptiler.buildStyleUrl(streets, { isDark: true })).toContain('streets-v2-dark');
  });

  it('ArcGIS imagery returns the v2 styles URL with token, theme-agnostic', () => {
    vi.stubEnv('VITE_ARCGIS_API_KEY', 'AGKEY');
    const imagery = getBasemapById('arcgis-imagery')!;
    const url = PROVIDERS.arcgis.buildStyleUrl(imagery, { isDark: false });
    expect(url).toBe(
      'https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis/imagery?token=AGKEY',
    );
    expect(PROVIDERS.arcgis.buildStyleUrl(imagery, { isDark: true })).toBe(url);
  });

  it('ArcGIS gray picks dark-gray ↔ light-gray by theme', () => {
    vi.stubEnv('VITE_ARCGIS_API_KEY', 'AGKEY');
    const gray = getBasemapById('arcgis-gray')!;
    expect(PROVIDERS.arcgis.buildStyleUrl(gray, { isDark: true })).toContain('arcgis/dark-gray');
    expect(PROVIDERS.arcgis.buildStyleUrl(gray, { isDark: false })).toContain('arcgis/light-gray');
  });
});

describe('lookups', () => {
  it('getBasemapById returns undefined for an unknown id', () => {
    expect(getBasemapById('not-a-real-id')).toBeUndefined();
  });
  it('DEFAULT_BASEMAP_ID is maptiler-streets', () => {
    expect(DEFAULT_BASEMAP_ID).toBe('maptiler-streets');
  });
});
