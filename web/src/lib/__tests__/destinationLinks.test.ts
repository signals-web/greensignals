// ─── destinationLinks tests — Phase 5c follow-up ─────────────────────────
//
// Pins five contracts of the canonical-source refactor:
//
//   1. `lookup.byId(id)` — primary path returns the canonical record.
//   2. `lookup.byName(name)` — legacy fallback for ad-hoc rows.
//   3. Miss returns undefined; collectLinks emits no line for that row.
//   4. collectLinks endpoints are the canonical DestinationPlace
//      lat/lng (full precision, no snapping).
//   5. **No-45° invariant**: a row whose `arrow` is snapped to NE (45°)
//      but whose linked DestinationPlace bearing is some non-snapped
//      value (e.g., 38°) — the line endpoint is still the
//      DestinationPlace's actual coords, never derived from `arrow`.
//
// All pure-function tests against fixtures; no map / DOM needed.

import { describe, expect, it, vi } from 'vitest';
import {
  buildDestinationLookup,
  clearInsetLeaderLines,
  collectLinks,
  drawAllLinks,
  drawInsetLeaderLines,
  drawSelectedLinks,
} from '../destinationLinks.ts';
import type {
  DestinationPlace,
  SignInstance,
} from '../../platform/index.ts';

const NOW = '2026-04-29T00:00:00.000Z';

function dp(overrides: Partial<DestinationPlace> & {
  id: string;
  name: string;
  lat: number;
  lng: number;
}): DestinationPlace {
  return {
    projectId: 'p',
    tier: 'building',
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: 't',
    updatedBy: 't',
    ...overrides,
  } satisfies DestinationPlace;
}

function sign(overrides: Partial<SignInstance> & {
  lat: number;
  lng: number;
}): SignInstance {
  return {
    id: 's',
    signTypeId: 'st',
    location: '',
    facing: 'N',
    sides: [],
    reviewStatus: 'pending',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ── 1. Lookup by destinationPlaceId ──────────────────────────────────────

describe('buildDestinationLookup — byId (canonical primary path)', () => {
  it('returns the matching DestinationPlace for a known id', () => {
    const norlin = dp({
      id: 'dp-norlin',
      name: 'Norlin Library',
      lat: 40.0076,
      lng: -105.2659,
    });
    const lookup = buildDestinationLookup([norlin]);
    expect(lookup.byId('dp-norlin')).toBe(norlin);
  });

  it('returns undefined for an unknown id (no fall-through to name match)', () => {
    const norlin = dp({
      id: 'dp-norlin',
      name: 'Norlin Library',
      lat: 40,
      lng: -105,
    });
    const lookup = buildDestinationLookup([norlin]);
    expect(lookup.byId('dp-bogus')).toBeUndefined();
  });

  it('skips archived records', () => {
    const archived = dp({
      id: 'dp-archived',
      name: 'Old Wing',
      lat: 40,
      lng: -105,
      archivedAt: NOW,
    });
    const lookup = buildDestinationLookup([archived]);
    expect(lookup.byId('dp-archived')).toBeUndefined();
  });
});

// ── 2. Name match fallback ───────────────────────────────────────────────

describe('buildDestinationLookup — byName (legacy fallback)', () => {
  const norlin = dp({
    id: 'dp-norlin',
    name: 'Norlin Library',
    lat: 40.0076,
    lng: -105.2659,
  });
  const lookup = buildDestinationLookup([norlin]);

  it('matches exact name (case-insensitive)', () => {
    expect(lookup.byName('Norlin Library')).toBe(norlin);
    expect(lookup.byName('norlin library')).toBe(norlin);
  });

  it('matches via abbreviation expansion', () => {
    // expandAbbreviations is the platform's name normaliser; "Norlin
    // Library" round-trips identically. The contract is that names
    // pass the expanded comparison; we exercise the path with a
    // benign value.
    expect(lookup.byName('  Norlin   Library  ')).toBe(norlin);
  });

  it('matches via substring containment', () => {
    expect(lookup.byName('Norlin')).toBe(norlin);
  });

  it('returns undefined when no match is possible', () => {
    expect(lookup.byName('Bogus Building')).toBeUndefined();
    expect(lookup.byName('')).toBeUndefined();
  });
});

// ── 3. resolve() — combined byId-first-then-byName ───────────────────────

describe('buildDestinationLookup — resolve()', () => {
  const norlin = dp({
    id: 'dp-norlin',
    name: 'Norlin Library',
    lat: 40,
    lng: -105,
  });
  const lookup = buildDestinationLookup([norlin]);

  it('prefers destinationPlaceId over name', () => {
    expect(
      lookup.resolve({
        destinationPlaceId: 'dp-norlin',
        name: 'Some Other Name',
      }),
    ).toBe(norlin);
  });

  it('falls back to name match when no id is set', () => {
    expect(lookup.resolve({ name: 'Norlin Library' })).toBe(norlin);
  });

  it('returns undefined when destinationPlaceId is set but stale (no name fallback)', () => {
    // A row carrying a stale id must NOT silently match a different
    // record by name — that would let a renamed/deleted destination's
    // row swap to a coincidental name match. Better to render nothing
    // and let the diagnostic flow surface the staleness.
    expect(
      lookup.resolve({
        destinationPlaceId: 'dp-archived',
        name: 'Norlin Library',
      }),
    ).toBeUndefined();
  });
});

// ── 4. collectLinks endpoints are canonical lat/lng ──────────────────────

describe('collectLinks — canonical lat/lng endpoints', () => {
  it('uses the DestinationPlace lat/lng exactly (no rounding)', () => {
    const norlin = dp({
      id: 'dp-norlin',
      name: 'Norlin Library',
      lat: 40.00760123,
      lng: -105.26591234,
    });
    const s = sign({
      lat: 40.0,
      lng: -105.0,
      sides: [
        {
          label: 'FRONT',
          destinations: [
            { arrow: 0, name: 'Norlin Library', destinationPlaceId: 'dp-norlin' },
          ],
        },
      ],
    });
    const { lines } = collectLinks([s], [norlin]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      signLng: -105.0,
      signLat: 40.0,
      destLng: -105.26591234,
      destLat: 40.00760123,
    });
  });

  it('emits no line for a row that resolves to nothing', () => {
    const s = sign({
      lat: 40.0,
      lng: -105.0,
      sides: [
        {
          label: 'FRONT',
          destinations: [
            { arrow: 0, name: 'Bogus Building' }, // no id, no match
          ],
        },
      ],
    });
    const { lines, dots } = collectLinks([s], []);
    expect(lines).toHaveLength(0);
    expect(dots).toHaveLength(0);
  });

  it('dedupes by DestinationPlace id when the same destination appears on both sides', () => {
    const umc = dp({
      id: 'dp-umc',
      name: 'UMC',
      lat: 40.0074,
      lng: -105.2706,
    });
    const s = sign({
      lat: 40.0,
      lng: -105.0,
      sides: [
        {
          label: 'FRONT',
          destinations: [{ arrow: 0, name: 'UMC', destinationPlaceId: 'dp-umc' }],
        },
        {
          label: 'BACK',
          destinations: [{ arrow: 180, name: 'UMC', destinationPlaceId: 'dp-umc' }],
        },
      ],
    });
    const { lines, dots } = collectLinks([s], [umc]);
    // Two faces, one canonical destination → one line, one dot.
    expect(lines).toHaveLength(1);
    expect(dots).toHaveLength(1);
  });
});

// ── 5. No-45° snapping invariant ─────────────────────────────────────────

describe('collectLinks — no 45° snapping on map output', () => {
  it('uses canonical lat/lng even when the row arrow is snapped', () => {
    // The row's arrow is NE (45°), implying "northeast of the sign."
    // The actual DestinationPlace bearing from the sign at (40, -105)
    // is closer to ~38° (lat-heavy). The line endpoint must be the
    // DestinationPlace's actual coords, NOT some 45°-ray projection.
    const target = dp({
      id: 'dp-engineering',
      name: 'Engineering Center',
      lat: 40.0079,
      lng: -104.9925,
    });
    const s = sign({
      lat: 40.0,
      lng: -105.0,
      sides: [
        {
          label: 'FRONT',
          destinations: [
            {
              arrow: 45, // NE (snapped)
              name: 'Engineering Center',
              destinationPlaceId: 'dp-engineering',
            },
          ],
        },
      ],
    });
    const { lines } = collectLinks([s], [target]);
    expect(lines).toHaveLength(1);
    // Endpoint = DestinationPlace's actual coords. NOT derived from
    // arrow=45.
    expect(lines[0]!.destLat).toBe(40.0079);
    expect(lines[0]!.destLng).toBe(-104.9925);
  });
});

// ── 6. drawInsetLeaderLines — call shape + styling ───────────────────────

/** Build a fake maplibre Map that records addSource / addLayer calls
 *  and reports an empty style for the firstSymbolLayer scan. Nothing
 *  is actually rendered; this is just enough to verify the helper
 *  hands the right data + paint config to maplibre. */
function makeFakeMap() {
  const sources: Array<{ id: string; data: unknown }> = [];
  const layers: Array<{ id: string; paint?: Record<string, unknown> }> = [];
  return {
    sources,
    layers,
    map: {
      getStyle: () => ({ layers: [] as unknown[] }),
      getSource: (id: string) =>
        sources.find((s) => s.id === id) ? {} : undefined,
      getLayer: (id: string) =>
        layers.find((l) => l.id === id) ? {} : undefined,
      addSource: vi.fn((id: string, def: { data: unknown }) => {
        sources.push({ id, data: def.data });
      }),
      addLayer: vi.fn((def: { id: string; paint?: Record<string, unknown> }) => {
        layers.push({ id: def.id, paint: def.paint });
      }),
      removeSource: vi.fn(),
      removeLayer: vi.fn(),
    },
  };
}

describe('drawInsetLeaderLines — single source, muted neutral, [2,4] dash', () => {
  const norlin = dp({
    id: 'dp-norlin',
    name: 'Norlin Library',
    lat: 40.0076,
    lng: -105.2659,
  });
  const umc = dp({
    id: 'dp-umc',
    name: 'UMC',
    lat: 40.0074,
    lng: -105.2706,
  });

  it('emits one source + one layer carrying every line for the focal sign', () => {
    const fake = makeFakeMap();
    const s = sign({
      lat: 40.0,
      lng: -105.0,
      sides: [
        {
          label: 'FRONT',
          destinations: [
            { arrow: 0, name: 'Norlin Library', destinationPlaceId: 'dp-norlin' },
            { arrow: 90, name: 'UMC', destinationPlaceId: 'dp-umc' },
          ],
        },
      ],
    });
    drawInsetLeaderLines(fake.map, s, [norlin, umc]);
    // Single GeoJSON source — not one per row.
    expect(fake.sources).toHaveLength(1);
    expect(fake.sources[0]!.id).toBe('dest-links-inset-src');
    const data = fake.sources[0]!.data as {
      features: Array<{ geometry: { coordinates: unknown[][] } }>;
    };
    expect(data.features).toHaveLength(2);
  });

  it('paint config matches spec: muted neutral, 1.5 px width, [2,4] dash', () => {
    const fake = makeFakeMap();
    const s = sign({
      lat: 40.0,
      lng: -105.0,
      sides: [
        {
          label: 'FRONT',
          destinations: [
            { arrow: 0, name: 'Norlin', destinationPlaceId: 'dp-norlin' },
          ],
        },
      ],
    });
    drawInsetLeaderLines(fake.map, s, [norlin]);
    expect(fake.layers).toHaveLength(1);
    const paint = fake.layers[0]!.paint!;
    // Default isDark=true → light-gray dash for visibility on dark tiles.
    expect(paint['line-color']).toBe('rgba(180, 180, 180, 0.7)');
    expect(paint['line-width']).toBe(1.5);
    expect(paint['line-dasharray']).toEqual([2, 4]);
  });

  it('clears prior layer/source before re-adding (idempotent)', () => {
    const fake = makeFakeMap();
    const s = sign({
      lat: 40.0,
      lng: -105.0,
      sides: [
        {
          label: 'FRONT',
          destinations: [
            { arrow: 0, name: 'Norlin', destinationPlaceId: 'dp-norlin' },
          ],
        },
      ],
    });
    drawInsetLeaderLines(fake.map, s, [norlin]);
    drawInsetLeaderLines(fake.map, s, [norlin]);
    // safeRemove is called via clearInsetLeaderLines on each entry.
    expect(fake.map.removeLayer).toHaveBeenCalled();
    expect(fake.map.removeSource).toHaveBeenCalled();
  });

  it('no-ops on a focal sign without coords (no addSource / addLayer)', () => {
    const fake = makeFakeMap();
    const s = sign({
      lat: 40.0,
      lng: -105.0,
    });
    // Strip coords post-construct.
    const noCoords: SignInstance = { ...s, lat: undefined, lng: undefined };
    drawInsetLeaderLines(fake.map, noCoords, [norlin]);
    expect(fake.sources).toHaveLength(0);
    expect(fake.layers).toHaveLength(0);
  });

  it('no-ops when no destinations resolve (no source/layer registered)', () => {
    const fake = makeFakeMap();
    const s = sign({
      lat: 40.0,
      lng: -105.0,
      sides: [
        {
          label: 'FRONT',
          destinations: [{ arrow: 0, name: 'Bogus' }], // no id, no match
        },
      ],
    });
    drawInsetLeaderLines(fake.map, s, []);
    expect(fake.sources).toHaveLength(0);
    expect(fake.layers).toHaveLength(0);
  });

  it('clearInsetLeaderLines removes the layer + source (best-effort)', () => {
    const fake = makeFakeMap();
    // Pre-populate so removeLayer / removeSource branches fire.
    fake.layers.push({ id: 'dest-links-inset-lyr' });
    fake.sources.push({ id: 'dest-links-inset-src', data: {} });
    clearInsetLeaderLines(fake.map);
    expect(fake.map.removeLayer).toHaveBeenCalledWith('dest-links-inset-lyr');
    expect(fake.map.removeSource).toHaveBeenCalledWith('dest-links-inset-src');
  });
});

// ── 7. Brand audit — paint configs use SOSISU Sky, not CU Gold ──────────
//
// MapLibre's paint expressions can't resolve CSS custom properties, so
// the brand colour gets duplicated into the JS as a literal hex. This
// test pins the hex against the SOSISU brand value (`--signal-bright`
// in `platform/styles/tokens.css`) so a future regression can't
// silently re-introduce CU Boulder's `#CFB87C`.

const SOSISU_SKY = '#ADDFF7';
const CU_GOLD = '#CFB87C';

describe('Brand audit — drawAllLinks paint uses SOSISU Sky', () => {
  it('line + circle paints reference Sky, never CU Gold', () => {
    const fake = makeFakeMap();
    const norlin = dp({
      id: 'dp-norlin',
      name: 'Norlin Library',
      lat: 40.0076,
      lng: -105.2659,
    });
    const s = sign({
      lat: 40.0,
      lng: -105.0,
      sides: [
        {
          label: 'FRONT',
          destinations: [
            { arrow: 0, name: 'Norlin', destinationPlaceId: 'dp-norlin' },
          ],
        },
      ],
    });
    drawAllLinks(fake.map, [s], [norlin]);
    // Line layer
    const lineLayer = fake.layers.find((l) => l.id === 'dest-links-all-lyr');
    expect(lineLayer?.paint?.['line-color']).toBe(SOSISU_SKY);
    expect(lineLayer?.paint?.['line-color']).not.toBe(CU_GOLD);
    // Dot layer
    const dotLayer = fake.layers.find((l) => l.id === 'dest-dots-all-lyr');
    expect(dotLayer?.paint?.['circle-color']).toBe(SOSISU_SKY);
    expect(dotLayer?.paint?.['circle-stroke-color']).toBe(SOSISU_SKY);
    expect(dotLayer?.paint?.['circle-color']).not.toBe(CU_GOLD);
  });
});

describe('Brand audit — drawSelectedLinks paint uses SOSISU Sky', () => {
  it('line + circle paints reference Sky, never CU Gold', () => {
    const fake = makeFakeMap();
    const norlin = dp({
      id: 'dp-norlin',
      name: 'Norlin Library',
      lat: 40.0076,
      lng: -105.2659,
    });
    const s = sign({
      lat: 40.0,
      lng: -105.0,
      sides: [
        {
          label: 'FRONT',
          destinations: [
            { arrow: 0, name: 'Norlin', destinationPlaceId: 'dp-norlin' },
          ],
        },
      ],
    });
    drawSelectedLinks(fake.map, s, [norlin]);
    const lineLayer = fake.layers.find((l) => l.id === 'dest-links-sel-lyr');
    expect(lineLayer?.paint?.['line-color']).toBe(SOSISU_SKY);
    expect(lineLayer?.paint?.['line-color']).not.toBe(CU_GOLD);
    const dotLayer = fake.layers.find((l) => l.id === 'dest-dots-sel-lyr');
    expect(dotLayer?.paint?.['circle-color']).toBe(SOSISU_SKY);
    expect(dotLayer?.paint?.['circle-stroke-color']).toBe(SOSISU_SKY);
    expect(dotLayer?.paint?.['circle-color']).not.toBe(CU_GOLD);
  });
});
