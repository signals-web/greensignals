// B1 Bug #4/#5 — end-to-end Tufts CSV import + buildings→destinations
// bridge regression test.
//
// Walks the REAL Tufts buildings sheet (the fixture Chris provided that
// surfaced the bug) through the exact pipeline ImportModal runs —
// Papa.parse → mapHeaders → remapRow → parseBuildingsCsv — then through
// the new bridge, asserting:
//   #4: all 155 rows import as buildings (none silently dropped), with
//       Category captured.
//   #5: the bridge produces 155 scored DestinationPlaces the schedule
//       generator can consume (pre-fix it produced zero).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { mapHeaders, remapRow } from '../csvHeaders.ts';
import { parseBuildingsCsv } from '../parseBuildingsCsv.ts';
import { mergeBuildingsIntoDestinations } from '../buildingsToDestinations.ts';

const TUFTS_CSV = readFileSync(
  fileURLToPath(new URL('./fixtures/tufts-buildings.csv', import.meta.url)),
  'utf8',
);

const TOTAL_ROWS = 155;

function parseTufts() {
  const result = Papa.parse<Record<string, string>>(TUFTS_CSV, {
    header: true,
    skipEmptyLines: true,
  });
  const rawHeaders = result.meta.fields ?? [];
  const headerMap = mapHeaders(rawHeaders);
  const rows = result.data.map((r) => remapRow(r, headerMap));
  return parseBuildingsCsv(rows);
}

describe('B1 #4 — Tufts buildings import (end-to-end)', () => {
  it('imports all 155 rows with zero rejections', () => {
    const { buildings, rejected } = parseTufts();
    expect(rejected).toHaveLength(0);
    expect(buildings).toHaveLength(TOTAL_ROWS);
  });

  it('maps Name→name, Lat→lat, Lng→lng and auto-generates building codes', () => {
    const { buildings } = parseTufts();
    const first = buildings[0]!.building;
    expect(first.name).toBe('10 Winthrop Street');
    expect(first.lat).toBeCloseTo(42.409575, 5);
    expect(first.lng).toBeCloseTo(-71.123364, 5);
    // No building_code column → auto-generated b001, b002, …
    expect(first.code).toMatch(/^b\d{3}$/);
  });

  it('captures Category when present and leaves it undefined when blank', () => {
    const { buildings } = parseTufts();
    const byName = new Map(
      buildings.map((b) => [b.building.name, b.building]),
    );
    // Row 2: "10 Winthrop Street,residence"
    expect(byName.get('10 Winthrop Street')?.category).toBe('residence');
    // Row 6: "Charles W. Tu House,," — empty category
    expect(byName.get('Charles W. Tu House')?.category).toBeUndefined();
  });

  it('survives leading-space lng values (e.g. "42.406964, -71.124314")', () => {
    const { buildings } = parseTufts();
    const byName = new Map(
      buildings.map((b) => [b.building.name, b.building]),
    );
    // Row 36: "45 Sawyer Avenue,residence,42.406964, -71.124314"
    expect(byName.get('45 Sawyer Avenue')?.lng).toBeCloseTo(-71.124314, 5);
  });
});

describe('B1 #5 — buildings → DestinationPlaces bridge (end-to-end)', () => {
  it('produces 155 scored DestinationPlaces from the Tufts import', () => {
    const { buildings } = parseTufts();
    const bldgs = buildings.map((b) => b.building);
    const { merged, upserted } = mergeBuildingsIntoDestinations(bldgs, [], {
      projectId: 'proj-tufts',
      createdBy: 'tester',
    });
    expect(merged).toHaveLength(TOTAL_ROWS);
    expect(upserted).toHaveLength(TOTAL_ROWS);
    // All carry coordinates (required for scoring) + tier 'building'.
    for (const d of merged) {
      expect(Number.isFinite(d.lat)).toBe(true);
      expect(Number.isFinite(d.lng)).toBe(true);
      expect(d.tier).toBe('building');
      expect(d.projectId).toBe('proj-tufts');
    }
    // Category carried through where present.
    const winthrop = merged.find((d) => d.name === '10 Winthrop Street');
    expect(winthrop?.category).toBe('residence');
  });

  it('is idempotent on re-import: dedups by name, no duplicates', () => {
    const { buildings } = parseTufts();
    const bldgs = buildings.map((b) => b.building);
    const first = mergeBuildingsIntoDestinations(bldgs, [], {
      projectId: 'proj-tufts',
      createdBy: 'tester',
    });
    const second = mergeBuildingsIntoDestinations(bldgs, first.merged, {
      projectId: 'proj-tufts',
      createdBy: 'tester',
    });
    // Same count — re-import updated in place rather than duplicating.
    expect(second.merged).toHaveLength(TOTAL_ROWS);
    // Ids preserved across re-import (dedup by name reused them).
    const firstIds = new Set(first.merged.map((d) => d.id));
    for (const d of second.merged) expect(firstIds.has(d.id)).toBe(true);
  });
});
