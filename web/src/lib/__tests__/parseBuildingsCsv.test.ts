// Phase 6 — parseBuildingsCsv coverage.
//
// Pins the relaxation contract so a later refactor can't silently
// re-introduce the "drops every row without building_code" bug that
// blocked Chris's Tufts trip. The brief's locked decisions:
//
//   - Required: building_name, lat, lng
//   - Optional: building_code (auto-generated b001..N when missing)
//   - Optional: floor_count, abbreviation
//   - Unknown columns: dropped silently (no error)
//   - Empty / non-numeric lat/lng: reject row with reason
//   - Whitespace: trimmed
//   - Empty building_name: reject row with reason

import { describe, it, expect } from 'vitest';
import { parseBuildingsCsv } from '../parseBuildingsCsv';

describe('parseBuildingsCsv — Tufts-shape CSV (no building_code)', () => {
  it('imports every row, auto-generates b001..bN codes', () => {
    const rows = [
      { building_name: 'Tisch Library', lat: '42.4067', lng: '-71.1186' },
      { building_name: 'Aidekman Center', lat: '42.4076', lng: '-71.1199' },
      { building_name: 'Cohen Auditorium', lat: '42.4079', lng: '-71.1202' },
    ];
    const result = parseBuildingsCsv(rows);
    expect(result.buildings).toHaveLength(3);
    expect(result.rejected).toEqual([]);
    expect(result.buildings.map((b) => b.building.code)).toEqual([
      'b001',
      'b002',
      'b003',
    ]);
    expect(result.buildings[0].building.id).toBe('bldg-b001');
    expect(result.buildings[0].building.name).toBe('Tisch Library');
    expect(result.buildings[0].building.lat).toBeCloseTo(42.4067, 4);
    expect(result.buildings[0].building.lng).toBeCloseTo(-71.1186, 4);
  });

  it('drops unknown columns silently (no error, no warning row)', () => {
    // Tufts CSV columns post-header-aliasing leave `id` (from "Dest
    // ID") and `category` (from "Category") as canonical keys with no
    // Buildings home. They should be ignored, not surfaced as
    // rejections.
    const rows = [
      {
        id: 'D-T-001',
        building_name: 'Tisch Library',
        category: 'Academic',
        lat: '42.4067',
        lng: '-71.1186',
      },
    ];
    const result = parseBuildingsCsv(rows);
    expect(result.buildings).toHaveLength(1);
    expect(result.rejected).toEqual([]);
    // Category / Dest ID dropped — not on the Building record
    expect(Object.keys(result.buildings[0].building)).not.toContain(
      'category',
    );
    expect(result.buildings[0].building).not.toHaveProperty('destId');
  });
});

describe('parseBuildingsCsv — explicit building_code preserved', () => {
  it('uses provided building_code when present', () => {
    const rows = [
      {
        building_code: 'TL-01',
        building_name: 'Tisch Library',
        lat: '42.4067',
        lng: '-71.1186',
      },
    ];
    const result = parseBuildingsCsv(rows);
    expect(result.buildings[0].building.code).toBe('TL-01');
    expect(result.buildings[0].building.id).toBe('bldg-tl-01');
  });

  it('mixes explicit codes with auto-generated codes in the same import', () => {
    const rows = [
      {
        building_code: 'TL-01',
        building_name: 'Tisch',
        lat: '42.4',
        lng: '-71.1',
      },
      { building_name: 'Aidekman', lat: '42.4', lng: '-71.1' },
      { building_name: 'Cohen', lat: '42.4', lng: '-71.1' },
    ];
    const result = parseBuildingsCsv(rows);
    expect(result.buildings.map((b) => b.building.code)).toEqual([
      'TL-01',
      'b001',
      'b002',
    ]);
  });
});

describe('parseBuildingsCsv — rejections', () => {
  it('rejects row when building_name is missing', () => {
    const rows = [{ lat: '42.4', lng: '-71.1' }];
    const result = parseBuildingsCsv(rows);
    expect(result.buildings).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('building_name');
    expect(result.rejected[0].row).toBe(2);
  });

  it('rejects row when lat is missing', () => {
    const rows = [{ building_name: 'X', lng: '-71.1' }];
    const result = parseBuildingsCsv(rows);
    expect(result.buildings).toEqual([]);
    expect(result.rejected[0].reason).toContain('lat');
  });

  it('rejects row when lng is missing', () => {
    const rows = [{ building_name: 'X', lat: '42.4' }];
    const result = parseBuildingsCsv(rows);
    expect(result.buildings).toEqual([]);
    expect(result.rejected[0].reason).toContain('lng');
  });

  it('rejects non-numeric lat with the offending value in the reason', () => {
    const rows = [
      { building_name: 'X', lat: 'abc', lng: '-71.1' },
    ];
    const result = parseBuildingsCsv(rows);
    expect(result.buildings).toEqual([]);
    expect(result.rejected[0].reason).toContain('non-numeric lat');
    expect(result.rejected[0].reason).toContain('"abc"');
  });

  it('rejects non-numeric lng', () => {
    const rows = [
      { building_name: 'X', lat: '42.4', lng: 'not-a-number' },
    ];
    const result = parseBuildingsCsv(rows);
    expect(result.buildings).toEqual([]);
    expect(result.rejected[0].reason).toContain('non-numeric lng');
  });

  it('preserves row numbers (1-indexed + header offset) on rejections', () => {
    // Row index 0 in our input = CSV row 2 (after header). Row 2 in
    // our input = CSV row 4.
    const rows = [
      { building_name: 'Good', lat: '42.4', lng: '-71.1' },
      { building_name: 'Bad', lat: 'oops', lng: '-71.1' },
      { building_name: 'Also good', lat: '42.5', lng: '-71.2' },
    ];
    const result = parseBuildingsCsv(rows);
    expect(result.buildings).toHaveLength(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].row).toBe(3);
  });

  it('auto-counter does NOT advance for rejected rows', () => {
    // Auto-codes only consume an index on SUCCESSFUL imports. A
    // rejected row in the middle of the stream shouldn't leave a
    // gap in the auto-counter sequence.
    const rows = [
      { building_name: 'A', lat: '42.4', lng: '-71.1' },
      { building_name: 'B', lat: 'bad', lng: '-71.1' }, // rejected
      { building_name: 'C', lat: '42.6', lng: '-71.1' },
    ];
    const result = parseBuildingsCsv(rows);
    expect(result.buildings.map((b) => b.building.code)).toEqual([
      'b001',
      'b002',
    ]);
  });
});

describe('parseBuildingsCsv — whitespace + optional fields', () => {
  it('trims whitespace on every string cell', () => {
    const rows = [
      {
        building_name: '  Tisch Library  ',
        lat: '  42.4067  ',
        lng: ' -71.1186 ',
        building_code: '  TL-01  ',
      },
    ];
    const result = parseBuildingsCsv(rows);
    expect(result.buildings[0].building.name).toBe('Tisch Library');
    expect(result.buildings[0].building.code).toBe('TL-01');
    expect(result.buildings[0].building.lat).toBeCloseTo(42.4067, 4);
  });

  it('parses floor_count when present', () => {
    const rows = [
      {
        building_name: 'Tisch',
        lat: '42.4',
        lng: '-71.1',
        floor_count: '4',
      },
    ];
    const result = parseBuildingsCsv(rows);
    expect(result.buildings[0].building.floorCount).toBe(4);
  });

  it('omits floor_count when missing or non-numeric', () => {
    const rows = [
      { building_name: 'A', lat: '42.4', lng: '-71.1' },
      {
        building_name: 'B',
        lat: '42.4',
        lng: '-71.1',
        floor_count: 'not-a-number',
      },
    ];
    const result = parseBuildingsCsv(rows);
    expect(result.buildings[0].building.floorCount).toBeUndefined();
    expect(result.buildings[1].building.floorCount).toBeUndefined();
  });

  it('preserves abbreviation when present', () => {
    const rows = [
      {
        building_name: 'Tisch Library',
        lat: '42.4',
        lng: '-71.1',
        abbreviation: 'TISCH',
      },
    ];
    const result = parseBuildingsCsv(rows);
    expect(result.buildings[0].building.abbreviation).toBe('TISCH');
  });
});
