// Hermetic tests for the CU Boulder seed transform. Fixtures embed
// small CSV-shaped row objects directly so the test doesn't depend on
// the live signs.csv / destinations.csv files (those are the source of
// truth for the demo, not for tests — drift in the live data
// shouldn't break the test suite).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCuBoulderSeed } from '../buildSeedProject.ts';
import type { DestinationRow, SignRow } from '../loadSeed.ts';

// Silence the warn-on-skip channel for the duration of the suite so
// expected skips don't pollute the test output. Tests that care about
// skip behaviour assert on the spy below.
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

const NOW = new Date('2026-04-26T00:00:00.000Z');

function destRow(overrides: Partial<DestinationRow> = {}): DestinationRow {
  return {
    'Dest ID': 'NORLIN_LIBRARY',
    Name: 'Norlin Library',
    Category: 'MAIN_CAMP',
    Lat: '40.00931',
    Lng: '-105.27069',
    District: 'Main Campus',
    Tier: '1',
    Notes: '1720 PLEASANT ST',
    'Include Always?': 'NO',
    'Exclude From Types': '',
    ...overrides,
  };
}

function signRow(overrides: Partial<SignRow> = {}): SignRow {
  return {
    Type: 'PM',
    Number: '1',
    Lat: '40.00931',
    Lng: '-105.27069',
    Facing: 'Main Campus',
    Neighborhood: 'Main Campus',
    ...overrides,
  };
}

describe('buildCuBoulderSeed — sign types', () => {
  it('emits exactly four sign types: M / N / PM / SD', () => {
    const seed = buildCuBoulderSeed({ signRows: [], destinationRows: [], now: NOW });
    expect(seed.signTypes.map((st) => st.code)).toEqual(['M', 'N', 'PM', 'SD']);
  });

  it('uses stable cu-bldr-st-* IDs', () => {
    const seed = buildCuBoulderSeed({ signRows: [], destinationRows: [], now: NOW });
    for (const st of seed.signTypes) {
      expect(st.id).toBe(`cu-bldr-st-${st.code}`);
    }
  });

  it('assigns sensible categories', () => {
    const seed = buildCuBoulderSeed({ signRows: [], destinationRows: [], now: NOW });
    const byCode = new Map(seed.signTypes.map((st) => [st.code, st]));
    expect(byCode.get('M')!.category).toBe('informational');
    expect(byCode.get('N')!.category).toBe('directional');
    expect(byCode.get('PM')!.category).toBe('directional');
    expect(byCode.get('SD')!.category).toBe('directional');
  });
});

describe('buildCuBoulderSeed — destinations', () => {
  it('maps tier 1 → campus, tier 2 → building, tier 3 → building', () => {
    const seed = buildCuBoulderSeed({
      signRows: [],
      now: NOW,
      destinationRows: [
        destRow({ 'Dest ID': 'A', Name: 'A', Tier: '1' }),
        destRow({ 'Dest ID': 'B', Name: 'B', Tier: '2' }),
        destRow({ 'Dest ID': 'C', Name: 'C', Tier: '3' }),
      ],
    });
    const byName = new Map(seed.destinations.map((d) => [d.name, d.tier]));
    expect(byName.get('A')).toBe('campus');
    expect(byName.get('B')).toBe('building');
    expect(byName.get('C')).toBe('building');
  });

  it("never writes tier: 'room'", () => {
    const seed = buildCuBoulderSeed({
      signRows: [],
      now: NOW,
      destinationRows: [
        destRow({ Tier: '1' }),
        destRow({ 'Dest ID': 'X', Name: 'X', Tier: '2' }),
        destRow({ 'Dest ID': 'Y', Name: 'Y', Tier: '3' }),
      ],
    });
    for (const dest of seed.destinations) {
      expect(dest.tier).not.toBe('room');
    }
  });

  it('normalises uppercase district to title case', () => {
    const seed = buildCuBoulderSeed({
      signRows: [],
      now: NOW,
      destinationRows: [destRow({ District: 'MAIN CAMPUS' })],
    });
    expect(seed.destinations).toHaveLength(1);
    expect(seed.destinations[0]!.district).toBe('Main Campus');
  });

  it('skips rows with unrecognised districts', () => {
    const seed = buildCuBoulderSeed({
      signRows: [],
      now: NOW,
      destinationRows: [
        destRow({ District: 'Main Campus' }),
        destRow({ 'Dest ID': 'WAT', Name: 'Wat', District: 'Westside Plaza' }),
      ],
    });
    expect(seed.destinations).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('skips rows with bad coords', () => {
    const seed = buildCuBoulderSeed({
      signRows: [],
      now: NOW,
      destinationRows: [
        destRow({ Lat: 'not-a-number' }),
        destRow({ 'Dest ID': 'OK', Name: 'OK' }),
      ],
    });
    expect(seed.destinations.map((d) => d.name)).toEqual(['OK']);
  });

  it('skips rows with bad/missing tier', () => {
    const seed = buildCuBoulderSeed({
      signRows: [],
      now: NOW,
      destinationRows: [
        destRow({ Tier: 'Main Campus' }), // the corrupt row
        destRow({ 'Dest ID': 'OK', Name: 'OK' }),
      ],
    });
    expect(seed.destinations.map((d) => d.name)).toEqual(['OK']);
  });

  it('uses stable cu-bldr-dest-* IDs from slugified Dest ID', () => {
    const seed = buildCuBoulderSeed({
      signRows: [],
      now: NOW,
      destinationRows: [destRow({ 'Dest ID': 'NORLIN_LIBRARY' })],
    });
    expect(seed.destinations[0]!.id).toBe('cu-bldr-dest-norlin-library');
  });

  it('round-trips notes (street address) and attribution', () => {
    const seed = buildCuBoulderSeed({
      signRows: [],
      now: NOW,
      destinationRows: [destRow({ Notes: '1720 PLEASANT ST' })],
    });
    const dest = seed.destinations[0]!;
    expect(dest.notes).toBe('1720 PLEASANT ST');
    expect(dest.createdBy).toBe('CU Boulder Messaging MKI v1 sheet');
    expect(dest.updatedBy).toBe('CU Boulder Messaging MKI v1 sheet');
  });

  it('inherits the override projectId on every record', () => {
    const seed = buildCuBoulderSeed({
      signRows: [],
      now: NOW,
      destinationRows: [destRow()],
      projectId: 'project-abc-123',
    });
    expect(seed.destinations[0]!.projectId).toBe('project-abc-123');
    expect(seed.project.id).toBe('project-abc-123');
  });
});

describe('buildCuBoulderSeed — sign instances', () => {
  it('uses stable cu-bldr-sign-{type}-{number} IDs', () => {
    const seed = buildCuBoulderSeed({
      destinationRows: [],
      now: NOW,
      signRows: [
        signRow({ Type: 'PM', Number: '1' }),
        signRow({ Type: 'SD', Number: '17' }),
      ],
    });
    expect(seed.instances.map((i) => i.id)).toEqual([
      'cu-bldr-sign-PM-1',
      'cu-bldr-sign-SD-17',
    ]);
  });

  it('points each instance at the matching sign type id', () => {
    const seed = buildCuBoulderSeed({
      destinationRows: [],
      now: NOW,
      signRows: [signRow({ Type: 'PM', Number: '1' })],
    });
    expect(seed.instances[0]!.signTypeId).toBe('cu-bldr-st-PM');
  });

  it("defaults every instance's facing to 'N'", () => {
    const seed = buildCuBoulderSeed({
      destinationRows: [],
      now: NOW,
      signRows: [
        signRow({ Type: 'M', Number: '1', Facing: 'whatever' }),
        signRow({ Type: 'N', Number: '2', Facing: 'East Campus' }),
      ],
    });
    for (const inst of seed.instances) {
      expect(inst.facing).toBe('N');
    }
  });

  it('starts every instance with empty sides — scoring fills them at runtime', () => {
    const seed = buildCuBoulderSeed({
      destinationRows: [],
      now: NOW,
      signRows: [signRow()],
    });
    expect(seed.instances[0]!.sides).toEqual([]);
  });

  it('skips rows with bad coords', () => {
    const seed = buildCuBoulderSeed({
      destinationRows: [],
      now: NOW,
      signRows: [
        signRow({ Number: '1', Lat: '' }),
        signRow({ Number: '2' }),
      ],
    });
    expect(seed.instances.map((i) => i.id)).toEqual(['cu-bldr-sign-PM-2']);
  });

  it('skips rows whose Type is unknown', () => {
    const seed = buildCuBoulderSeed({
      destinationRows: [],
      now: NOW,
      signRows: [
        signRow({ Type: 'XX', Number: '1' }),
        signRow({ Number: '2' }),
      ],
    });
    expect(seed.instances.map((i) => i.id)).toEqual(['cu-bldr-sign-PM-2']);
  });

  it('carries district from Neighborhood column', () => {
    const seed = buildCuBoulderSeed({
      destinationRows: [],
      now: NOW,
      signRows: [signRow({ Neighborhood: 'East Campus' })],
    });
    expect(seed.instances[0]!.neighborhood).toBe('East Campus');
  });

  it('dedupes duplicate (type, number) rows — first occurrence wins', () => {
    const seed = buildCuBoulderSeed({
      destinationRows: [],
      now: NOW,
      signRows: [
        signRow({ Type: 'N', Number: '5', Lat: '40.0' }),
        signRow({ Type: 'N', Number: '5', Lat: '40.1' }),
        signRow({ Type: 'N', Number: '6', Lat: '40.2' }),
      ],
    });
    const ns = seed.instances.filter((i) => i.signTypeId === 'cu-bldr-st-N');
    expect(ns).toHaveLength(2);
    // First occurrence wins, so lat=40.0 not 40.1.
    expect(ns.find((i) => i.id === 'cu-bldr-sign-N-5')!.lat).toBe(40.0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('duplicate id'),
      'cu-bldr-sign-N-5',
      expect.anything(),
    );
  });
});

describe('buildCuBoulderSeed — live CSV smoke test', () => {
  it('emits roughly the expected counts when fed the live CSV files', () => {
    const seed = buildCuBoulderSeed({ now: NOW });
    expect(seed.signTypes).toHaveLength(4);
    // Source data: 118 sign rows, 152 fully-tagged destinations.
    // Tolerate ±5 in case the live CSVs are touched up over time.
    expect(seed.instances.length).toBeGreaterThanOrEqual(113);
    expect(seed.instances.length).toBeLessThanOrEqual(123);
    expect(seed.destinations.length).toBeGreaterThanOrEqual(145);
    expect(seed.destinations.length).toBeLessThanOrEqual(155);
  });

  it('every live destination falls into one of the five canonical districts', () => {
    const valid = new Set([
      'Main Campus',
      'East Campus',
      'Williams Village',
      'Grandview',
      'North Boulder Creek',
    ]);
    const seed = buildCuBoulderSeed({ now: NOW });
    for (const dest of seed.destinations) {
      expect(valid.has(dest.district ?? '')).toBe(true);
    }
  });

  it('no live destination is tier room', () => {
    const seed = buildCuBoulderSeed({ now: NOW });
    for (const dest of seed.destinations) {
      expect(dest.tier).not.toBe('room');
    }
  });
});
