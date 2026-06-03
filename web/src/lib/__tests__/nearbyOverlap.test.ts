// ─── nearbyOverlap tests — Phase 5d v2 ──────────────────────────────────
//
// Pins the contracts for the Neighborhood section's pure analysis:
//
//   1. nearbySigns sorted ascending by distance.
//   2. Distance filter — a sign past `maxDistanceMeters` is excluded.
//   3. sharedDestinations counted from the current sign's destinations
//      that ALSO appear on at least one neighbour (by id).
//   4. Lookup is by destinationPlaceId, not name. Coincidental name
//      matches with different ids never count as shared.
//   5. Empty inputs return empty arrays without crashing.
//
// Pure-function tests against fixtures, no DOM / map needed.

import { describe, expect, it } from 'vitest';
import {
  analyzeNeighborhood,
  bearingToCompass8,
  metresToFeet,
} from '../nearbyOverlap.ts';
import type {
  DestinationPlace,
  SignInstance,
} from '../../platform/index.ts';

const NOW = '2026-04-30T00:00:00.000Z';

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
  id: string;
}): SignInstance {
  return {
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

// ─── 1. nearbySigns sorted ──────────────────────────────────────────────

describe('analyzeNeighborhood — nearbySigns are sorted by distance', () => {
  it('returns the closer sign first', () => {
    const current = sign({ id: 'self', lat: 40.0, lng: -105.0 });
    // ~111 m north at this latitude per 0.001 deg of lat.
    const near = sign({ id: 'near', lat: 40.001, lng: -105.0 });
    const far = sign({ id: 'far', lat: 40.003, lng: -105.0 });
    const result = analyzeNeighborhood({
      current,
      allSigns: [current, far, near], // intentionally out of order
      destinations: [],
      maxDistanceMeters: 500, // override — `far` is past the 200 m default
    });
    expect(result.nearbySigns).toHaveLength(2);
    expect(result.nearbySigns[0]!.sign.id).toBe('near');
    expect(result.nearbySigns[1]!.sign.id).toBe('far');
    expect(result.nearbySigns[0]!.distanceMeters).toBeLessThan(
      result.nearbySigns[1]!.distanceMeters,
    );
  });

  it('annotates each entry with a bearing in [0, 360)', () => {
    const current = sign({ id: 'self', lat: 40.0, lng: -105.0 });
    const east = sign({ id: 'east', lat: 40.0, lng: -104.999 });
    const north = sign({ id: 'north', lat: 40.001, lng: -105.0 });
    const result = analyzeNeighborhood({
      current,
      allSigns: [current, east, north],
      destinations: [],
    });
    const eastEntry = result.nearbySigns.find((s) => s.sign.id === 'east')!;
    const northEntry = result.nearbySigns.find((s) => s.sign.id === 'north')!;
    expect(eastEntry.bearingDegrees).toBeGreaterThan(80);
    expect(eastEntry.bearingDegrees).toBeLessThan(100);
    // True north at this longitude is exactly 0°.
    expect(northEntry.bearingDegrees).toBeLessThan(2);
  });
});

// ─── 2. Distance filter ─────────────────────────────────────────────────

describe('analyzeNeighborhood — maxDistanceMeters filters out far signs', () => {
  it('excludes a sign 600 m away when radius is 500 m', () => {
    const current = sign({ id: 'self', lat: 40.0, lng: -105.0 });
    // ~600 m north — past 500 m radius.
    const beyond = sign({ id: 'beyond', lat: 40.0054, lng: -105.0 });
    const result = analyzeNeighborhood({
      current,
      allSigns: [current, beyond],
      destinations: [],
      maxDistanceMeters: 500,
    });
    expect(result.nearbySigns).toHaveLength(0);
  });

  it('uses a default radius of 200 m when none is provided', () => {
    const current = sign({ id: 'self', lat: 40.0, lng: -105.0 });
    const within = sign({ id: 'within', lat: 40.001, lng: -105.0 }); // ~111 m
    const beyond = sign({ id: 'beyond', lat: 40.003, lng: -105.0 }); // ~333 m
    const result = analyzeNeighborhood({
      current,
      allSigns: [current, within, beyond],
      destinations: [],
    });
    expect(result.nearbySigns.map((n) => n.sign.id)).toEqual(['within']);
  });
});

// ─── 3. Shared destinations counted ─────────────────────────────────────

describe('analyzeNeighborhood — sharedDestinations counted across neighbours', () => {
  it('counts neighbours per destination, sorted most-shared first', () => {
    const A = dp({ id: 'dp-A', name: 'A', lat: 40.01, lng: -105.0 });
    const B = dp({ id: 'dp-B', name: 'B', lat: 40.02, lng: -105.0 });
    const C = dp({ id: 'dp-C', name: 'C', lat: 40.03, lng: -105.0 });
    const D = dp({ id: 'dp-D', name: 'D', lat: 40.04, lng: -105.0 });
    const current = sign({
      id: 'self',
      lat: 40.0,
      lng: -105.0,
      sides: [
        {
          label: 'FRONT',
          destinations: [
            { arrow: 0, name: 'A', destinationPlaceId: 'dp-A' },
            { arrow: 0, name: 'B', destinationPlaceId: 'dp-B' },
            { arrow: 0, name: 'C', destinationPlaceId: 'dp-C' },
          ],
        },
      ],
    });
    const n1 = sign({
      id: 'n1',
      lat: 40.001,
      lng: -105.0,
      sides: [
        {
          label: 'FRONT',
          destinations: [
            { arrow: 0, name: 'A', destinationPlaceId: 'dp-A' },
            { arrow: 0, name: 'C', destinationPlaceId: 'dp-C' },
          ],
        },
      ],
    });
    const n2 = sign({
      id: 'n2',
      lat: 40.002,
      lng: -105.0,
      sides: [
        {
          label: 'FRONT',
          destinations: [
            { arrow: 0, name: 'C', destinationPlaceId: 'dp-C' },
            { arrow: 0, name: 'D', destinationPlaceId: 'dp-D' },
          ],
        },
      ],
    });
    const result = analyzeNeighborhood({
      current,
      allSigns: [current, n1, n2],
      destinations: [A, B, C, D],
      maxDistanceMeters: 500, // override — `n2` is past the 200 m default
    });
    // C is shared by both neighbours → first.
    expect(result.sharedDestinations).toHaveLength(2);
    expect(result.sharedDestinations[0]!.destination.id).toBe('dp-C');
    expect(result.sharedDestinations[0]!.coveringNeighbors.map((s) => s.id))
      .toEqual(['n1', 'n2']);
    // A is shared by n1 only.
    expect(result.sharedDestinations[1]!.destination.id).toBe('dp-A');
    expect(result.sharedDestinations[1]!.coveringNeighbors.map((s) => s.id))
      .toEqual(['n1']);
    // B (only on self) and D (only on n2) NOT in shared.
    expect(
      result.sharedDestinations.find((s) => s.destination.id === 'dp-B'),
    ).toBeUndefined();
    expect(
      result.sharedDestinations.find((s) => s.destination.id === 'dp-D'),
    ).toBeUndefined();
  });
});

// ─── 4. Lookup is by id, not name ───────────────────────────────────────

describe('analyzeNeighborhood — sharedDestinations matches by id, not by name', () => {
  it('coincidental name collisions with different ids do NOT count as shared', () => {
    // Two DestinationPlaces with the same display name but different
    // ids — e.g. "Hall" on the East Campus vs "Hall" on the West.
    const eastHall = dp({
      id: 'dp-east-hall',
      name: 'Hall',
      lat: 40.01,
      lng: -105.0,
    });
    const westHall = dp({
      id: 'dp-west-hall',
      name: 'Hall',
      lat: 40.02,
      lng: -105.01,
    });
    const current = sign({
      id: 'self',
      lat: 40.0,
      lng: -105.0,
      sides: [
        {
          label: 'FRONT',
          destinations: [
            { arrow: 0, name: 'Hall', destinationPlaceId: 'dp-east-hall' },
          ],
        },
      ],
    });
    const neighbor = sign({
      id: 'n1',
      lat: 40.001,
      lng: -105.0,
      sides: [
        {
          label: 'FRONT',
          destinations: [
            { arrow: 0, name: 'Hall', destinationPlaceId: 'dp-west-hall' },
          ],
        },
      ],
    });
    const result = analyzeNeighborhood({
      current,
      allSigns: [current, neighbor],
      destinations: [eastHall, westHall],
    });
    // Different ids → not shared, even though both rows say "Hall".
    expect(result.sharedDestinations).toHaveLength(0);
  });
});

// ─── 5. Empty / degenerate inputs ───────────────────────────────────────

describe('analyzeNeighborhood — empty / degenerate inputs are safe', () => {
  it('returns empty arrays when there are no signs and no destinations', () => {
    const current = sign({ id: 'self', lat: 40.0, lng: -105.0 });
    const result = analyzeNeighborhood({
      current,
      allSigns: [current],
      destinations: [],
    });
    expect(result.nearbySigns).toEqual([]);
    expect(result.sharedDestinations).toEqual([]);
  });

  it('returns empty nearbySigns when current sign has no coords', () => {
    const noCoords: SignInstance = {
      ...sign({ id: 'self' }),
      lat: undefined,
      lng: undefined,
    };
    const other = sign({ id: 'other', lat: 40.0, lng: -105.0 });
    const result = analyzeNeighborhood({
      current: noCoords,
      allSigns: [noCoords, other],
      destinations: [],
    });
    expect(result.nearbySigns).toEqual([]);
  });

  it('skips archived destinations (treated as missing)', () => {
    const archived = dp({
      id: 'dp-archived',
      name: 'Old Wing',
      lat: 40.01,
      lng: -105.0,
      archivedAt: NOW,
    });
    const current = sign({
      id: 'self',
      lat: 40.0,
      lng: -105.0,
      sides: [
        {
          label: 'FRONT',
          destinations: [
            { arrow: 0, name: 'Old Wing', destinationPlaceId: 'dp-archived' },
          ],
        },
      ],
    });
    const neighbor = sign({
      id: 'n1',
      lat: 40.001,
      lng: -105.0,
      sides: [
        {
          label: 'FRONT',
          destinations: [
            { arrow: 0, name: 'Old Wing', destinationPlaceId: 'dp-archived' },
          ],
        },
      ],
    });
    const result = analyzeNeighborhood({
      current,
      allSigns: [current, neighbor],
      destinations: [archived],
    });
    // Archived dp not surfaced as shared, despite both signs referencing
    // it — the diagnostic flow surfaces staleness elsewhere.
    expect(result.sharedDestinations).toHaveLength(0);
  });
});

// ─── Display helpers ────────────────────────────────────────────────────

describe('bearingToCompass8', () => {
  it('maps cardinal + intercardinal directions correctly', () => {
    expect(bearingToCompass8(0)).toBe('N');
    expect(bearingToCompass8(45)).toBe('NE');
    expect(bearingToCompass8(90)).toBe('E');
    expect(bearingToCompass8(135)).toBe('SE');
    expect(bearingToCompass8(180)).toBe('S');
    expect(bearingToCompass8(225)).toBe('SW');
    expect(bearingToCompass8(270)).toBe('W');
    expect(bearingToCompass8(315)).toBe('NW');
  });

  it('rounds to the nearest 8-point label', () => {
    // 22° is closer to N (0) than NE (45) — boundary at 22.5°.
    expect(bearingToCompass8(22)).toBe('N');
    expect(bearingToCompass8(355)).toBe('N');
    expect(bearingToCompass8(30)).toBe('NE');
    expect(bearingToCompass8(80)).toBe('E');
  });
});

describe('metresToFeet', () => {
  it('rounds to the nearest foot', () => {
    expect(metresToFeet(100)).toBe(328);
    expect(metresToFeet(0)).toBe(0);
    expect(metresToFeet(98)).toBe(322);
  });
});
