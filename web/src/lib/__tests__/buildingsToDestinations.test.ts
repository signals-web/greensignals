// B1 Bug #4/#5 — buildings→destinations bridge unit tests.
//
// Edge cases for mergeBuildingsIntoDestinations beyond the Tufts
// end-to-end coverage in tuftsImport.test.ts.

import { describe, it, expect } from 'vitest';
import type { Building, DestinationPlace } from '../../platform/index.ts';
import { mergeBuildingsIntoDestinations } from '../buildingsToDestinations.ts';

function bldg(overrides: Partial<Building> = {}): Building {
  return {
    id: 'bldg-x',
    code: 'b001',
    name: 'Test Hall',
    lat: 42.4,
    lng: -71.1,
    ...overrides,
  };
}

const OPTS = { projectId: 'proj-1', createdBy: 'tester' };

describe('mergeBuildingsIntoDestinations', () => {
  it('mints a tier-building DestinationPlace per coord-bearing building', () => {
    const { merged, upserted } = mergeBuildingsIntoDestinations(
      [bldg({ name: 'A' }), bldg({ name: 'B' })],
      [],
      OPTS,
    );
    expect(merged).toHaveLength(2);
    expect(upserted).toHaveLength(2);
    expect(merged.every((d) => d.tier === 'building')).toBe(true);
  });

  it('skips buildings with no coordinates (can\'t be scored)', () => {
    const { merged, upserted } = mergeBuildingsIntoDestinations(
      [bldg({ name: 'NoCoords', lat: undefined, lng: undefined })],
      [],
      OPTS,
    );
    expect(merged).toHaveLength(0);
    expect(upserted).toHaveLength(0);
  });

  it('skips buildings with a blank name', () => {
    const { merged } = mergeBuildingsIntoDestinations(
      [bldg({ name: '   ' })],
      [],
      OPTS,
    );
    expect(merged).toHaveLength(0);
  });

  it('carries category onto the destination when present', () => {
    const { merged } = mergeBuildingsIntoDestinations(
      [bldg({ name: 'Dining Hall', category: 'dining' })],
      [],
      OPTS,
    );
    expect(merged[0]!.category).toBe('dining');
  });

  it('updates an existing destination in place (dedup by name, case-insensitive), preserving id', () => {
    const existing: DestinationPlace = {
      id: 'dp-existing',
      projectId: 'proj-1',
      name: 'Library',
      lat: 1,
      lng: 2,
      tier: 'building',
      isAnchor: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'old',
      updatedBy: 'old',
    };
    const { merged, upserted } = mergeBuildingsIntoDestinations(
      [bldg({ name: 'library', lat: 9, lng: 8, category: 'academic' })],
      [existing],
      OPTS,
    );
    expect(merged).toHaveLength(1);
    expect(upserted).toHaveLength(1);
    const updated = merged[0]!;
    expect(updated.id).toBe('dp-existing'); // id preserved
    expect(updated.lat).toBe(9); // coords refreshed
    expect(updated.lng).toBe(8);
    expect(updated.category).toBe('academic'); // category refreshed
    expect(updated.isAnchor).toBe(true); // anchor flag preserved
  });

  it('does not duplicate when the same building name appears twice in one import', () => {
    const { merged } = mergeBuildingsIntoDestinations(
      [bldg({ name: 'Twice', lat: 1, lng: 1 }), bldg({ name: 'Twice', lat: 2, lng: 2 })],
      [],
      OPTS,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.lat).toBe(2); // last write wins
  });
});
