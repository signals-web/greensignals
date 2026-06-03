// ─── Map-label helper tests — Phase 5c follow-up ─────────────────────────
//
// Pins:
//
//   1. `shouldHideLayer` — the granular pattern matcher. Hides POI /
//      building / natural / transit / place labels. Keeps road and
//      street labels (navigation context).
//   2. `hideOsmLabels` — calls `setLayoutProperty('visibility','none')`
//      only on the right layer ids; never on road labels; tolerates
//      missing style / setLayoutProperty without throwing.
//
// `drawDestinationLabels` is DOM-shape work and is verified live via
// the preview — the same vitest worker-spinup issue documented in
// other tests applies, and the lookup logic is small enough that
// inline review is sufficient.

import { describe, expect, it, vi } from 'vitest';
import { hideOsmLabels, shouldHideLayer } from '../mapLabels.ts';

describe('shouldHideLayer — granular pattern matcher', () => {
  it('hides POI label layers', () => {
    expect(shouldHideLayer('poi-label')).toBe(true);
    expect(shouldHideLayer('poi_label')).toBe(true);
    expect(shouldHideLayer('mt-poi')).toBe(true);
  });

  it('keeps building polygons (visual context for sign placement)', () => {
    expect(shouldHideLayer('building')).toBe(false);
    expect(shouldHideLayer('building-3d')).toBe(false);
    expect(shouldHideLayer('Building')).toBe(false);
    expect(shouldHideLayer('Building 3D')).toBe(false);
  });

  it('still hides building label/name layers (text only)', () => {
    expect(shouldHideLayer('building-label')).toBe(true);
    expect(shouldHideLayer('building-name')).toBe(true);
  });

  it('hides natural-feature labels (parks, water)', () => {
    expect(shouldHideLayer('natural-label')).toBe(true);
  });

  it('hides transit labels (bus stops, stations)', () => {
    expect(shouldHideLayer('transit-label')).toBe(true);
    expect(shouldHideLayer('transit_label')).toBe(true);
  });

  it('hides place labels (city / neighborhood names)', () => {
    expect(shouldHideLayer('place-label')).toBe(true);
    expect(shouldHideLayer('place_label')).toBe(true);
  });

  it('hides house-number labels', () => {
    expect(shouldHideLayer('housenum-label')).toBe(true);
  });

  it('keeps road / street labels (navigation context)', () => {
    expect(shouldHideLayer('road')).toBe(false);
    expect(shouldHideLayer('road-label')).toBe(false);
    expect(shouldHideLayer('road-name')).toBe(false);
    expect(shouldHideLayer('street-label')).toBe(false);
    expect(shouldHideLayer('road-shield')).toBe(false);
  });

  it('keeps bridge and tunnel layers', () => {
    expect(shouldHideLayer('bridge-road')).toBe(false);
    expect(shouldHideLayer('tunnel-road')).toBe(false);
  });

  it('returns false for unknown / non-label layers', () => {
    expect(shouldHideLayer('background')).toBe(false);
    expect(shouldHideLayer('water')).toBe(false);
    expect(shouldHideLayer('landuse')).toBe(false);
    expect(shouldHideLayer('admin-boundary')).toBe(false);
  });

  it('returns false for empty / missing ids', () => {
    expect(shouldHideLayer(undefined)).toBe(false);
    expect(shouldHideLayer(null)).toBe(false);
    expect(shouldHideLayer('')).toBe(false);
  });
});

describe('hideOsmLabels — applies visibility:none to matching layers only', () => {
  it('calls setLayoutProperty only on hide-pattern layers', () => {
    const setLayoutProperty = vi.fn();
    const map = {
      getStyle: () => ({
        layers: [
          { id: 'background' },
          { id: 'landuse' },
          { id: 'water' },
          { id: 'building' }, // keep — polygons stay for visual context
          { id: 'road' }, // keep
          { id: 'road-label' }, // keep
          { id: 'poi-label' }, // hide
          { id: 'place-label' }, // hide
          { id: 'transit-label' }, // hide
          { id: 'street-label' }, // keep
        ],
      }),
      setLayoutProperty,
    };
    hideOsmLabels(map);
    const hiddenIds = setLayoutProperty.mock.calls.map((c) => c[0]).sort();
    expect(hiddenIds).toEqual([
      'place-label',
      'poi-label',
      'transit-label',
    ]);
    // Confirm visibility=none on every hidden call.
    for (const call of setLayoutProperty.mock.calls) {
      expect(call[1]).toBe('visibility');
      expect(call[2]).toBe('none');
    }
  });

  it('NEVER hides road or street labels (navigation context)', () => {
    const setLayoutProperty = vi.fn();
    const map = {
      getStyle: () => ({
        layers: [
          { id: 'road' },
          { id: 'road-label' },
          { id: 'road-name' },
          { id: 'road-shield' },
          { id: 'street-label' },
          { id: 'bridge-road' },
          { id: 'tunnel-road' },
        ],
      }),
      setLayoutProperty,
    };
    hideOsmLabels(map);
    expect(setLayoutProperty).not.toHaveBeenCalled();
  });

  it('tolerates a map with no style (no-op, no throw)', () => {
    expect(() => hideOsmLabels({ getStyle: () => null })).not.toThrow();
    expect(() => hideOsmLabels({})).not.toThrow();
  });

  it('tolerates a setLayoutProperty that throws (best-effort)', () => {
    const setLayoutProperty = vi.fn(() => {
      throw new Error('layer is read-only');
    });
    const map = {
      getStyle: () => ({ layers: [{ id: 'poi-label' }] }),
      setLayoutProperty,
    };
    expect(() => hideOsmLabels(map)).not.toThrow();
    expect(setLayoutProperty).toHaveBeenCalledOnce();
  });
});
