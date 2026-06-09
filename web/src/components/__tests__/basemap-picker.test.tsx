// Phase I1 — BasemapPicker. renderToStaticMarkup (node env, no DOM events) for
// structure; the option→id mapping is verified via the exported pure helper
// since the suite can't fire a <select> change event.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BasemapPicker, optionValueToBasemapId } from '../BasemapPicker.tsx';

const html = (ui: React.ReactElement) => renderToStaticMarkup(ui);
const optionCount = (m: string) => (m.match(/<option/g) || []).length;
afterEach(() => vi.unstubAllEnvs());

describe('optionValueToBasemapId', () => {
  it('maps the default option to undefined and other values to the id', () => {
    expect(optionValueToBasemapId('')).toBeUndefined();
    expect(optionValueToBasemapId('arcgis-imagery')).toBe('arcgis-imagery');
  });
});

describe('BasemapPicker — rendered options', () => {
  it('shows default + 4 MapTiler options when only MapTiler is configured', () => {
    vi.stubEnv('VITE_MAPTILER_KEY', 'mt');
    vi.stubEnv('VITE_ARCGIS_API_KEY', '');
    const m = html(<BasemapPicker value={undefined} onChange={() => {}} />);
    expect(optionCount(m)).toBe(5); // default + 4
    expect(m).toContain('Default (MapTiler Streets)');
    expect(m).toContain('<optgroup label="MapTiler"');
    expect(m).not.toContain('<optgroup label="ArcGIS"');
  });

  it('shows default + 8 options when both providers are configured', () => {
    vi.stubEnv('VITE_MAPTILER_KEY', 'mt');
    vi.stubEnv('VITE_ARCGIS_API_KEY', 'ag');
    const m = html(<BasemapPicker value={undefined} onChange={() => {}} />);
    expect(optionCount(m)).toBe(9); // default + 8
    expect(m).toContain('<optgroup label="ArcGIS"');
  });

  it('renders the empty-state notice (with env var names) when no providers configured', () => {
    vi.stubEnv('VITE_MAPTILER_KEY', '');
    vi.stubEnv('VITE_ARCGIS_API_KEY', '');
    const m = html(<BasemapPicker value={undefined} onChange={() => {}} />);
    expect(m).toContain('data-testid="basemap-empty"');
    expect(m).toContain('VITE_MAPTILER_KEY');
    expect(m).toContain('VITE_ARCGIS_API_KEY');
    expect(m).not.toContain('data-testid="basemap-select"');
  });

  it('warns when the selected basemap belongs to an unconfigured provider', () => {
    vi.stubEnv('VITE_MAPTILER_KEY', 'mt');
    vi.stubEnv('VITE_ARCGIS_API_KEY', ''); // ArcGIS off
    const m = html(<BasemapPicker value="arcgis-imagery" onChange={() => {}} />);
    expect(m).toContain('data-testid="basemap-unavailable"');
    expect(m).toContain('using default');
  });
});
